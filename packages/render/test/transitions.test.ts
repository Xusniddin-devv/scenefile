import { fileURLToPath } from "node:url";
import { check, checkWithAssets } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { ALL_SCENES } from "../../scenes/test/fixtures";
import { captureFrame, openComposition, probeClip } from "../src/index";

const baseDir = fileURLToPath(new URL("../../scenes/test", import.meta.url));

const title = (heading: string) => ({ type: "title", heading: `${heading} one two three four five` });

function compose(input: Record<string, unknown>) {
  const result = check({ version: 1, ...input });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}


async function stateAt(page: Awaited<ReturnType<typeof openComposition>>["page"], frame: number) {
  await captureFrame(page, frame);
  return page.evaluate(() => {
    const scenes = Array.from(document.querySelectorAll<HTMLElement>(".sf-scene:not([hidden])"), (el) => ({
      index: Number(el.dataset.sfScene),
      opacity: el.style.opacity,
      transform: el.style.transform,
      clipPath: el.style.clipPath,
      zIndex: el.style.zIndex,
      left: el.getBoundingClientRect().left,
    }));
    const chrome = document.querySelector<HTMLElement>(".sf-chrome");
    const wipe = document.querySelector<HTMLElement>(".sf-wipe");
    return {
      scenes,
      counter: document.querySelector(".sf-chrome__index")?.textContent ?? "",
      counterTop: document.querySelector(".sf-chrome")?.getBoundingClientRect().top ?? -1,
      counters: document.querySelectorAll(".sf-chrome").length,
      chromeOpacity: Number(chrome ? getComputedStyle(chrome).opacity : -1),
      wipeOpacity: Number(wipe && !wipe.hidden ? getComputedStyle(wipe).opacity : 0),
      wipeShown: wipe ? !wipe.hidden : false,
      wipeLeft: wipe?.getBoundingClientRect().left ?? -1,
    };
  });
}

describe.each([30, 60] as const)("transitions at %i fps", (fps) => {
  const run = async (kind: string, inspect: (states: Awaited<ReturnType<typeof stateAt>>[], overlap: number) => void) => {
    const composition = compose({ fps, transition: kind, scenes: [title("First"), title("Second")] });
    const second = composition.manifest.scenes[1];
    if (!second) throw new Error("no second scene");
    const session = await openComposition(composition);
    try {
      const frames = [
        second.startFrame - 1,
        second.startFrame,
        second.startFrame + Math.floor(second.overlapFrames / 2),
        second.startFrame + Math.max(0, second.overlapFrames - 1),
        second.startFrame + second.overlapFrames,
      ];
      const states = [];
      for (const frame of frames) states.push(await stateAt(session.page, frame));
      inspect(states, second.overlapFrames);
    } finally {
      await session.close();
    }
  };

  it("push slides the old scene out to the left as the new one comes in from the right", async () => {
    await run("push", ([before, start, middle, end, after], overlap) => {
      expect(overlap).toBe(fps / 2);
      expect(before?.scenes.map((s) => s.index)).toEqual([0]);
      expect(start?.scenes.map((s) => s.index)).toEqual([0, 1]);
      expect(middle?.scenes[0]?.left).toBeLessThan(-300);
      expect(middle?.scenes[1]?.left).toBeGreaterThan(300);
      expect(end?.scenes[1]?.left).toBeLessThan(middle?.scenes[1]?.left ?? 0);
      expect(after?.scenes.map((s) => [s.index, s.transform, s.zIndex, s.left])).toEqual([[1, "", "", 0]]);
    });
  });

  it("wipe uncovers the new scene behind a moving edge", async () => {
    await run("wipe", ([before, start, middle, end, after]) => {
      expect(before?.wipeShown).toBe(false);
      // At the ends of its travel the edge sits at the frame's edge; it fades in and out rather than parking there.
      expect(start?.wipeOpacity).toBeLessThan(0.5);
      expect(end?.wipeOpacity).toBeLessThan(0.5);
      expect(middle?.wipeOpacity).toBe(1);
      expect(middle?.scenes.map((s) => s.index)).toEqual([0, 1]);
      expect(middle?.scenes[1]?.clipPath).toMatch(/^inset\(/);
      expect(middle?.wipeShown).toBe(true);
      expect(middle?.wipeLeft).toBeGreaterThan(200);
      expect(after?.wipeShown).toBe(false);
      expect(after?.scenes.map((s) => [s.index, s.clipPath])).toEqual([[1, ""]]);
    });
  });

  it("crossfade and zoom bring the new scene up over the old one", async () => {
    for (const kind of ["crossfade", "zoom"]) {
      await run(kind, ([, start, middle, end, after]) => {
        const rising = [start, middle, end].map((state) => Number(state?.scenes[1]?.opacity));
        expect(rising[0]).toBeGreaterThan(0);
        expect(rising[1]).toBeGreaterThan(rising[0] ?? 1);
        expect(rising[2]).toBeGreaterThan(rising[1] ?? 1);
        expect(rising[2]).toBeLessThan(1);
        expect(after?.scenes.map((s) => [s.index, s.opacity, s.transform])).toEqual([[1, "1", ""]]);
      });
    }
  });

  it("cut and fade never draw two scenes at once", async () => {
    for (const kind of ["cut", "fade"]) {
      await run(kind, (states, overlap) => {
        expect(overlap).toBe(0);
        for (const state of states) expect(state.scenes).toHaveLength(1);
      });
    }
  });

  it("keeps one scene counter, in one place, counting the scene that is arriving", async () => {
    await run("push", (states) => {
      expect(states.map((state) => state.counters)).toEqual([1, 1, 1, 1, 1]);
      expect(new Set(states.map((state) => state.counterTop)).size).toBe(1);
      // The number changes halfway through, when the new scene has taken over the frame.
      expect(states.map((state) => state.counter)).toEqual(["01 / 02", "01 / 02", "02 / 02", "02 / 02", "02 / 02"]);
      for (const state of states) expect(state.chromeOpacity).toBe(1);
    });
  });
});

describe("the scene counter at the ends of the video", () => {
  it("arrives with the first scene and leaves with the last, instead of sitting lit on a black frame", async () => {
    const composition = compose({ transition: "push", scenes: [title("First"), title("Second")] });
    const last = composition.manifest.totalFrames - 1;
    const session = await openComposition(composition);
    try {
      const opacity = async (frame: number): Promise<number> => (await stateAt(session.page, frame)).chromeOpacity;
      expect(await opacity(0)).toBeLessThan(0.2);
      expect(await opacity(40)).toBe(1);
      expect(await opacity(last)).toBeLessThan(0.2);
      expect(await opacity(last - 30)).toBe(1);
    } finally {
      await session.close();
    }
  });
});

describe("the automatic choice, with every scene type, in a tall frame at 60 fps", () => {
  it("leaves nothing behind after each transition, and draws the same pixels in any order", async () => {
    const result = await checkWithAssets({ version: 1, fps: 60, format: "portrait-1080p", scenes: ALL_SCENES }, { baseDir, probeClip });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const composition = result.composition;
    const kinds = new Set(composition.manifest.scenes.map((scene) => scene.transition));
    for (const kind of ["push", "wipe", "zoom"]) expect(kinds, kind).toContain(kind);

    const session = await openComposition(composition);
    try {
      // Just after every transition: exactly one scene, with nothing a transition set still on it.
      for (const scene of composition.manifest.scenes.slice(1)) {
        const state = await stateAt(session.page, scene.startFrame + scene.overlapFrames);
        expect(state.scenes.map((s) => [s.index, s.transform, s.clipPath, s.zIndex]), `after scene ${scene.index} arrives`).toEqual([
          [scene.index, "", "", ""],
        ]);
        expect(state.wipeShown).toBe(false);
      }
      // Inside every transition: pixels do not depend on what was drawn before.
      const frames = composition.manifest.scenes.slice(1).flatMap((scene) => {
        const span = Math.max(scene.overlapFrames, 8);
        return [2, Math.floor(span / 2), span - 2].map((offset) => scene.startFrame + offset);
      });
      const first: Buffer[] = [];
      for (const frame of frames) first.push(await captureFrame(session.page, frame));
      const mismatched: number[] = [];
      for (let i = frames.length - 1; i >= 0; i -= 1) {
        const frame = frames[i];
        const expected = first[i];
        if (frame === undefined || !expected) throw new Error("bad index");
        await captureFrame(session.page, (frame * 7 + 13) % composition.manifest.totalFrames);
        if (!(await captureFrame(session.page, frame)).equals(expected)) mismatched.push(frame);
      }
      expect(mismatched).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

describe("transitions and reproducibility", () => {
  it("draws identical pixels mid-transition whatever was drawn before, for every kind", async () => {
    const kinds = ["push", "wipe", "zoom", "crossfade", "cut", "fade"];
    const scenes = [
      title("Start"),
      ...kinds.map((kind, i) =>
        i % 2 === 0
          ? { type: "statement", text: `Scene ${i} says a few short words here.`, transition: kind }
          : { type: "terminal", steps: [{ run: `echo ${i}`, output: "ok" }], transition: kind },
      ),
    ];
    const composition = compose({ scenes });
    // Three frames inside each transition window, and one either side of it.
    const frames = composition.manifest.scenes.slice(1).flatMap((scene) => {
      const span = Math.max(scene.overlapFrames, 6);
      return [-1, 1, Math.floor(span / 2), span - 1, span + 2].map((offset) => scene.startFrame + offset);
    });
    let seed = 77;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const session = await openComposition(composition);
    try {
      const sequential: Buffer[] = [];
      for (const frame of frames) sequential.push(await captureFrame(session.page, frame));
      const mismatched = new Set<number>();
      for (let pass = 0; pass < 2; pass++) {
        const order = frames.map((_, i) => i).sort(() => random() - 0.5);
        for (const i of order) {
          const frame = frames[i];
          const expected = sequential[i];
          if (frame === undefined || !expected) throw new Error("bad index");
          if (!(await captureFrame(session.page, frame)).equals(expected)) mismatched.add(frame);
        }
      }
      expect([...mismatched].sort((a, b) => a - b)).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
