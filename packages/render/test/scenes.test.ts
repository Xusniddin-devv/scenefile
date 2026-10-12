import { type Composition, check, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { ALL_SCENES } from "../../scenes/test/fixtures";
import { captureFrame, inspectComposition, openComposition } from "../src/index";

function compose(format: string): Composition {
  const result = check({ version: 1, format, scenes: ALL_SCENES });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}

describe("every scene type, in a real browser", () => {
  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])("fits its ordinary content in %s", async (format) => {
    const report = await inspectComposition(compose(format));
    expect(verifyLayout(report)).toEqual([]);
    const fittedScenes = new Set(report.slots.map((slot) => slot.path.split(".")[0]));
    expect(fittedScenes.size).toBe(ALL_SCENES.length);
    for (const slot of report.slots) expect(slot.sizePx, slot.path).toBeGreaterThanOrEqual(3.4 * 10.8 - 0.01);
  });

  it("keeps the typing caret on the line it is typing, even when that line is full", async () => {
    // "$ npx scenefile init" exactly fills the outro's command column at its largest size.
    const result = check({
      version: 1,
      scenes: [
        { type: "outro", heading: "Make your first video.", command: "npx scenefile init", url: "scenefile.dev" },
        { type: "terminal", steps: [{ run: "x".repeat(60) }, { run: "ls" }] },
      ],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const session = await openComposition(result.composition);
    try {
      for (const scene of result.composition.manifest.scenes) {
        for (const local of [scene.enterFrames + 20, scene.durationFrames - scene.exitFrames - 1]) {
          await captureFrame(session.page, scene.startFrame + local);
          const offsets = await session.page.evaluate(() => {
            const visible = document.querySelector(".sf-scene:not([hidden])");
            const carets = Array.from(visible?.querySelectorAll<HTMLElement>(".sf-terminal__caret, .sf-outro__caret") ?? []);
            return carets
              .filter((caret) => getComputedStyle(caret).visibility !== "hidden")
              .map((caret) => {
                const typed = caret.previousElementSibling;
                const lines = typed ? Array.from(typed.getClientRects()) : [];
                const last = lines.at(-1);
                const box = caret.getBoundingClientRect();
                // With nothing typed yet there is no line to compare against.
                return last && last.width > 0 ? Math.abs(box.bottom - last.bottom) / last.height : 0;
              });
          });
          for (const offset of offsets) expect(offset, `${scene.type} frame ${local}`).toBeLessThan(0.5);
        }
      }
    } finally {
      await session.close();
    }
  });

  it("draws identical pixels for a frame whatever was drawn before it", async () => {
    const composition = compose("landscape-1080p");
    const total = composition.manifest.totalFrames;
    const frames = Array.from({ length: 48 }, (_, i) => Math.round((i * (total - 1)) / 47));
    let seed = 2026;
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
        const order = frames.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          const a = order[i];
          const b = order[j];
          if (a === undefined || b === undefined) throw new Error("bad index");
          order[i] = b;
          order[j] = a;
        }
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

  it("reports content that cannot fit, for the scenes most likely to be overfilled", async () => {
    const long = "Supercalifragilisticexpialidocious".repeat(4);
    const result = check({
      version: 1,
      scenes: [
        { type: "statement", text: long },
        { type: "code", lang: "ts", source: Array.from({ length: 16 }, (_, i) => `const value${i} = "${"x".repeat(100)}";`).join("\n") },
        { type: "bullets", items: Array.from({ length: 5 }, () => `${"W".repeat(60)} item`) },
      ],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const diagnostics = verifyLayout(await inspectComposition(result.composition));
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["TEXT_OVERFLOW", "scenes[0].text"],
      ["TEXT_OVERFLOW", "scenes[1].source"],
      ["TEXT_OVERFLOW", "scenes[2].items"],
    ]);
  });
});
