import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ClipInfo, check, checkWithAssets } from "../src/index";

const info = (seconds = 12.4, width = 1920, height = 1080, audio = true): ClipInfo => ({ file: "/abs/a.mp4", width, height, seconds, audio });
const loaded = (clips: Record<string, ClipInfo>) => ({ assets: new Map(), diagnostics: [], clips: new Map(Object.entries(clips)) });
const video = (clip: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  version: 1,
  ...extra,
  scenes: [{ type: "title", heading: "Before", duration: 2 }, { type: "clip", src: "a.mp4", ...clip }, { type: "outro", heading: "After" }],
});

describe("a clip in the timeline", () => {
  it("lasts exactly as long as the part of the file that is used, and is cut to and from", () => {
    const result = check(video({ from: 2, to: 7 }), loaded({ "a.mp4": info() }));
    expect(result.diagnostics).toEqual([]);
    const [, clip, after] = result.video?.scenes ?? [];
    expect(clip).toMatchObject({ type: "clip", durationFrames: 150, transition: "cut", enterFrames: 0, exitFrames: 0, overlapFrames: 0 });
    expect(after).toMatchObject({ transition: "cut", overlapFrames: 0 });
    expect(after?.startFrame).toBe((clip?.startFrame ?? 0) + 150);
    expect(result.composition?.clips).toEqual([
      expect.objectContaining({ file: "/abs/a.mp4", fromSeconds: 2, seconds: 5, atSeconds: (clip?.startFrame ?? 0) / 30, volume: 1 }),
    ]);
    expect(result.storyboard).toMatch(/clip\s+.*a\.mp4, 2\.00s to 7\.00s of 12\.40s/);
  });

  it("uses the whole file when no cut is given", () => {
    const result = check(video({}), loaded({ "a.mp4": info(12.4) }));
    expect(result.video?.scenes[1]?.durationFrames).toBe(372);
  });

  it("refuses a cut outside the file, saying how long the file is", () => {
    const beyond = check(video({ from: 2, to: 20 }), loaded({ "a.mp4": info(12.4) }));
    expect(beyond.ok).toBe(false);
    expect(beyond.diagnostics).toEqual([expect.objectContaining({ code: "CLIP_RANGE", severity: "error", path: "scenes[1].to" })]);
    expect(beyond.diagnostics[0]?.message).toContain("12.4");
    const late = check(video({ from: 30 }), loaded({ "a.mp4": info(12.4) }));
    expect(late.diagnostics).toEqual([expect.objectContaining({ code: "CLIP_RANGE", path: "scenes[1].from" })]);
    const backwards = check(video({ from: 5, to: 3 }), loaded({ "a.mp4": info() }));
    expect(backwards.diagnostics[0]).toMatchObject({ severity: "error", path: "scenes[1].to" });
  });

  it("says so when a clip was not found or read", () => {
    expect(check(video({})).diagnostics).toEqual([expect.objectContaining({ code: "ASSET_NOT_FOUND", path: "scenes[1].src" })]);
  });

  it("refuses narration longer than the clip it is over", () => {
    const speech = new Map([[1, { file: "/cache/1.wav", seconds: 9 }]]);
    const result = check(video({ from: 0, to: 4, volume: 0, say: "A long explanation of what is happening here." }), { ...loaded({ "a.mp4": info() }), speech });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "CLIP_TOO_SHORT", severity: "error", path: "scenes[1].say" })]);
  });
});

describe("warnings about footage", () => {
  const codes = (clip: Record<string, unknown>, shape: Partial<ClipInfo> = {}, extra: Record<string, unknown> = {}) =>
    check(video(clip, extra), loaded({ "a.mp4": { ...info(), ...shape } })).diagnostics.map((d) => [d.code, d.severity, d.path]);

  it("refuses a picture too large to work with", () => {
    expect(codes({}, { width: 16000, height: 16000 })).toEqual([["ASSET_TOO_LARGE", "error", "scenes[1].src"]]);
  });

  it("says when footage is HDR, which is drawn without being converted", () => {
    expect(codes({}, { hdr: true })).toEqual([["CLIP_HDR", "warning", "scenes[1].src"]]);
  });

  it("says when a voice would be talking over the clip's own sound", () => {
    expect(codes({ from: 0, to: 9, say: "A short line." })).toEqual([["VOICE_OVER_SOUND", "warning", "scenes[1].volume"]]);
    expect(codes({ from: 0, to: 9, say: "A short line.", volume: 0.2 })).toEqual([]);
    expect(codes({ from: 0, to: 9, say: "A short line." }, { audio: false })).toEqual([]);
  });

  it("says when a transition or a longer duration was asked for and cannot be given", () => {
    expect(codes({ transition: "fade" })).toEqual([["FIELD_IGNORED", "warning", "scenes[1].transition"]]);
    expect(codes({ from: 0, to: 5, duration: 10 })).toEqual([["FIELD_IGNORED", "warning", "scenes[1].duration"]]);
    expect(codes({ from: 0, to: 5, duration: 3 })).toEqual([]);
  });
});

describe("where a clip is drawn", () => {
  it("puts the caption directly under the clip, starting at its left edge", () => {
    const result = check(video({ caption: "Signing in" }, { format: "portrait-1080p" }), loaded({ "a.mp4": info(5, 1920, 1080) }));
    const placed = result.composition?.clips?.[0];
    const html = result.composition?.html ?? "";
    const style = /class="sf-clip__caption"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? "";
    const top = Number(/top:(\d+)px/.exec(style)?.[1]);
    const left = Number(/left:(\d+)px/.exec(style)?.[1]);
    expect(left).toBe(placed?.x);
    expect(top - ((placed?.y ?? 0) + (placed?.height ?? 0))).toBeGreaterThan(0);
    expect(top - ((placed?.y ?? 0) + (placed?.height ?? 0))).toBeLessThan(60);
    // On the pixel grid a video encoder uses for color, so no line of the page shows beside the clip.
    expect([(placed?.x ?? 1) % 2, (placed?.y ?? 1) % 2]).toEqual([0, 0]);
  });

  const place = (clip: Record<string, unknown>, shape: ClipInfo, extra: Record<string, unknown> = {}) => {
    const result = check(video(clip, extra), loaded({ "a.mp4": shape }));
    const placed = result.composition?.clips?.[0];
    if (!placed) throw new Error(JSON.stringify(result.diagnostics));
    return placed;
  };

  it("fits a clip inside the frame's margins without changing its shape", () => {
    const wide = place({}, info(5, 1920, 1080));
    expect(wide.x).toBeGreaterThanOrEqual(90);
    expect(wide.y).toBeGreaterThanOrEqual(170);
    expect(wide.x + wide.width).toBeLessThanOrEqual(1920 - 90);
    expect(wide.y + wide.height).toBeLessThanOrEqual(1080 - 80);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    const tall = place({}, info(5, 1080, 1920));
    expect(tall.width / tall.height).toBeCloseTo(9 / 16, 1);
    expect(tall.height).toBeGreaterThan(700);
    // Footage sits in the middle of the width it could have used, not against one edge.
    expect(Math.abs(tall.x + tall.width / 2 - 960)).toBeLessThanOrEqual(1);
    // Sizes a video encoder accepts.
    for (const placed of [wide, tall]) expect([placed.width % 2, placed.height % 2]).toEqual([0, 0]);
  });

  it("can fill the whole frame instead", () => {
    expect(place({ fit: "cover" }, info(5, 1080, 1920))).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080, cover: true });
  });

  it("stays above the caption band when there is one", () => {
    const captioned = { voice: { name: "en-emma", captions: true } };
    const say = "Short line.";
    const result = check(
      { version: 1, ...captioned, scenes: [{ type: "clip", src: "a.mp4", fit: "cover", say }, { type: "outro", heading: "After", say }] },
      loaded({ "a.mp4": info(8) }),
    );
    const placed = result.composition?.clips?.[0];
    expect((placed?.y ?? 0) + (placed?.height ?? 0)).toBeLessThanOrEqual(1080 - 17 * 10.8 + 1);
  });

  it("is silent when asked to be, or when the file has no sound", () => {
    expect(place({ volume: 0 }, info()).volume).toBe(0);
    expect(place({}, info(5, 1920, 1080, false)).volume).toBe(0);
    expect(place({ volume: 0.3 }, info()).volume).toBe(0.3);
  });
});

describe("finding clips on disk", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "scenefile-clipfiles-"));
    writeFileSync(join(dir, "a.mp4"), "not really a video");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads only files in the scenefile's folder, and asks what each one is", async () => {
    const asked: string[] = [];
    const probeClip = async (file: string) => {
      asked.push(file);
      return { file, width: 640, height: 360, seconds: 4, audio: true };
    };
    const good = await checkWithAssets(video({ from: 1, to: 3 }), { baseDir: dir, probeClip });
    expect(good.diagnostics).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/a\.mp4$/);
    const outside = await checkWithAssets(video({ src: "../a.mp4" }), { baseDir: dir, probeClip });
    expect(outside.diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND", path: "scenes[1].src" });
    const remote = await checkWithAssets(video({ src: "https://example.com/a.mp4" }), { baseDir: dir, probeClip });
    expect(remote.diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND", path: "scenes[1].src" });
    expect(asked).toHaveLength(1);
  });

  it("reports a file that is not a video", async () => {
    const result = await checkWithAssets(video({}), { baseDir: dir, probeClip: async () => null });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "ASSET_UNSUPPORTED", path: "scenes[1].src" })]);
  });
});
