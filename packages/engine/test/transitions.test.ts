import { normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { check } from "../src/check";
import { resolve } from "../src/resolve";
import { TRANSITION_SECONDS, isOverlapping, pickTransitions } from "../src/transitions";

const title = (heading: string, more: Record<string, unknown> = {}) => ({ type: "title", heading, ...more });
const statement = (text: string, more: Record<string, unknown> = {}) => ({ type: "statement", text, ...more });
const code = { type: "code", source: "x = 1" };
const stat = { type: "stat", value: "94%", label: "valid" };

function scenefile(input: Record<string, unknown>) {
  const { scenefile: parsed, diagnostics } = normalize({ version: 1, ...input });
  if (!parsed) throw new Error(JSON.stringify(diagnostics));
  return parsed;
}

describe("pickTransitions", () => {
  it("gives the first scene none, and every later scene a kind that suits it", () => {
    const picked = pickTransitions(scenefile({ scenes: [title("a"), statement("b"), code, stat, title("c")] }));
    expect(picked[0]).toBe("none");
    expect(picked.slice(1)).toEqual(["push", "wipe", "zoom", "fade"]);
  });

  it("never picks the same kind twice in a row", () => {
    const scenes = [title("a"), code, { type: "terminal", steps: [{ run: "ls" }] }, code, code, code];
    const picked = pickTransitions(scenefile({ scenes }));
    for (let i = 2; i < picked.length; i++) expect(picked[i], `scene ${i}`).not.toBe(picked[i - 1]);
  });

  it("pushes between two scenes of the same type", () => {
    expect(pickTransitions(scenefile({ scenes: [stat, stat] }))[1]).toBe("push");
  });

  it("uses the scenefile's transition for every scene, and a scene's own over that", () => {
    const all = pickTransitions(scenefile({ transition: "crossfade", scenes: [title("a"), code, stat] }));
    expect(all).toEqual(["none", "crossfade", "crossfade"]);
    const mixed = pickTransitions(scenefile({ transition: "cut", scenes: [title("a"), { ...code, transition: "wipe" }, stat] }));
    expect(mixed).toEqual(["none", "wipe", "cut"]);
  });

  it("ignores a transition asked of the first scene", () => {
    expect(pickTransitions(scenefile({ scenes: [title("a", { transition: "push" }), code] }))[0]).toBe("none");
  });

  it("knows which kinds draw both scenes at once", () => {
    expect(["crossfade", "push", "wipe", "zoom"].every((kind) => isOverlapping(kind as never))).toBe(true);
    expect(isOverlapping("cut")).toBe(false);
    expect(isOverlapping("fade")).toBe(false);
  });

  it("rejects an unknown transition with the allowed ones", () => {
    const { diagnostics } = normalize({ version: 1, scenes: [title("a"), title("b", { transition: "spin" })] });
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "scenes[1].transition" });
    expect(diagnostics[0]?.fix).toContain('"push"');
  });
});

describe("the timeline with transitions", () => {
  const overlap = Math.round(TRANSITION_SECONDS * 30);
  const frames = (input: Record<string, unknown>) =>
    resolve(scenefile(input)).video.scenes.map((s) => [s.startFrame, s.durationFrames, s.exitFrames, s.transition, s.overlapFrames]);

  it("with fade, scenes follow one another and each fades out", () => {
    // Two titles of 2.5 s: 75 frames each, exit 12.
    expect(frames({ transition: "fade", scenes: [title("Hi"), title("Yo")] })).toEqual([
      [0, 75, 12, "none", 0],
      [75, 75, 12, "fade", 0],
    ]);
  });

  it("with cut, scenes follow one another and the earlier one does not fade", () => {
    expect(frames({ transition: "cut", scenes: [title("Hi"), title("Yo")] })).toEqual([
      [0, 75, 0, "none", 0],
      [75, 75, 12, "cut", 0],
    ]);
  });

  it("with an overlapping kind, the later scene starts before the earlier one ends", () => {
    const result = resolve(scenefile({ transition: "push", scenes: [title("Hi"), title("Yo"), title("Ok")] }));
    expect(result.video.scenes.map((s) => [s.startFrame, s.durationFrames, s.exitFrames, s.overlapFrames])).toEqual([
      [0, 75, 0, 0],
      [75 - overlap, 75, 0, overlap],
      [150 - 2 * overlap, 75, 12, overlap],
    ]);
    expect(result.video.totalFrames).toBe(225 - 2 * overlap);
  });

  it("scales the overlap with the frame rate", () => {
    const at60 = resolve(scenefile({ fps: 60, transition: "push", scenes: [title("Hi"), title("Yo")] })).video.scenes;
    expect(at60[1]?.overlapFrames).toBe(30);
  });

  it("shrinks the overlap for very short scenes, never starting a scene before the one ahead of it", () => {
    const result = resolve(
      scenefile({ transition: "push", scenes: [title("Hi", { duration: 1.1 }), title("Yo", { duration: 1.1 }), title("Ok", { duration: 3 })] }),
    );
    const scenes = result.video.scenes;
    for (let i = 1; i < scenes.length; i++) {
      const before = scenes[i - 1];
      const scene = scenes[i];
      if (!before || !scene) throw new Error("missing scene");
      expect(scene.startFrame).toBeGreaterThan(before.startFrame);
      expect(scene.overlapFrames).toBeLessThan(before.durationFrames);
      expect(scene.overlapFrames).toBeLessThan(scene.durationFrames);
      expect(scene.startFrame).toBe(before.startFrame + before.durationFrames - scene.overlapFrames);
    }
  });

  it("does not let a transition begin before the earlier scene's content has finished appearing", () => {
    // A stat needs 0.5 s to enter and 0.9 s to count.
    const scenes = resolve(scenefile({ transition: "push", scenes: [{ ...stat, duration: 1.5 }, title("Yo", { duration: 3 })] })).video.scenes;
    const [first, second] = scenes;
    if (!first || !second) throw new Error("missing scene");
    const countedBy = first.enterFrames + Math.ceil(0.9 * 30);
    expect(second.startFrame).toBeGreaterThanOrEqual(countedBy);
  });

  it("puts each scene's transition in the manifest and the storyboard", () => {
    const result = check({ version: 1, scenes: [title("one two three four five six"), statement("seven eight nine ten")] });
    expect(result.composition?.manifest.scenes.map((s) => [s.transition, s.overlapFrames])).toEqual([["none", 0], ["push", overlap]]);
    const lines = result.storyboard.split("\n");
    expect(lines[1]).not.toContain("enters by");
    expect(lines[2]).toMatch(/^2\. statement .*\(enters by push\)$/);
  });
});
