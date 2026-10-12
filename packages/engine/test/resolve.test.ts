import { normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve";

function resolved(input: unknown) {
  const { scenefile, diagnostics } = normalize(input);
  if (!scenefile) throw new Error(JSON.stringify(diagnostics));
  return resolve(scenefile);
}

describe("resolve", () => {
  it("sizes an auto scene as enter + hold + exit, in frames", () => {
    // title: enter 0.6, exit 0.4, min hold 1.5; six words read in 2 s
    const { video, diagnostics } = resolved({
      version: 1,
      scenes: [{ type: "title", heading: "one two three", sub: "four five six" }],
    });
    expect(diagnostics).toEqual([]);
    expect(video).toMatchObject({ width: 1920, height: 1080, fps: 30, totalFrames: 90 });
    expect(video.scenes[0]).toMatchObject({ startFrame: 0, durationFrames: 90, enterFrames: 18, exitFrames: 12 });
  });

  it("uses the minimum hold when there is little to read", () => {
    const { video } = resolved({
      version: 1,
      scenes: [{ type: "title", heading: "Hi" }, { type: "title", heading: "Yo" }],
    });
    expect(video.scenes.map((s) => [s.startFrame, s.durationFrames])).toEqual([[0, 75], [75, 75]]);
    expect(video.totalFrames).toBe(150);
  });

  it("scales frames with fps and sizes with format", () => {
    const { video } = resolved({
      version: 1,
      fps: 60,
      format: "portrait-1080p",
      scenes: [{ type: "title", heading: "Hi" }, { type: "title", heading: "Yo" }],
    });
    expect(video).toMatchObject({ width: 1080, height: 1920, fps: 60, totalFrames: 300 });
  });

  it("warns when an explicit duration is too short to read", () => {
    const { video, diagnostics } = resolved({
      version: 1,
      scenes: [
        { type: "title", heading: "one two three four five six seven eight nine", duration: 2 },
        { type: "title", heading: "Hi", duration: 3 },
      ],
    });
    expect(video.scenes[0]?.durationFrames).toBe(60);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "PACING_FAST", severity: "warning", path: "scenes[0].duration" }),
    ]);
    expect(diagnostics[0]?.fix).toContain("4.0");
  });

  it("warns when an explicit duration is far longer than needed", () => {
    const { diagnostics } = resolved({
      version: 1,
      scenes: [{ type: "title", heading: "Hi", duration: 20 }],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "PACING_SLOW", severity: "warning", path: "scenes[0].duration" }),
    ]);
  });

  it("never makes a scene shorter than its enter and exit", () => {
    const { video } = resolved({
      version: 1,
      scenes: [
        { type: "title", heading: "Hi", duration: 0.2 },
        { type: "title", heading: "Hi", duration: 5 },
      ],
    });
    expect(video.scenes[0]?.durationFrames).toBe(31);
  });

  it("rejects a video shorter than three seconds", () => {
    const { diagnostics } = resolved({ version: 1, scenes: [{ type: "title", heading: "Hi" }] });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "TOTAL_DURATION", severity: "error", path: "scenes" }),
    ]);
  });

  it("rejects a video longer than ten minutes", () => {
    const scenes = Array.from({ length: 6 }, () => ({ type: "title", heading: "Hi", duration: 110 }));
    const { diagnostics } = resolved({ version: 1, scenes });
    expect(diagnostics.filter((d) => d.code === "TOTAL_DURATION")).toHaveLength(1);
  });
});
