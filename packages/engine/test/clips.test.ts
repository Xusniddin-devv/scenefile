import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize } from "@scenefile/schema";
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

describe("captions from what is said in a clip", () => {
  const heard = [
    { start: 0.5, end: 3, text: "Here are two recordings, cut and joined." },
    { start: 4, end: 9, text: "This part is past the end of what is shown." },
  ];
  const withCaptions = (clip: Record<string, unknown> = {}) => video({ from: 2, to: 7, captions: true, ...clip });

  it("shows each thing said, when it is said, in the caption band", () => {
    const result = check(withCaptions(), { ...loaded({ "a.mp4": info() }), transcripts: new Map([[1, heard]]) });
    expect(result.diagnostics).toEqual([]);
    const clip = result.video?.scenes[1];
    const html = result.composition?.html ?? "";
    expect(html).toContain('id="sf-stage" class="sf-captioned"');
    const from = (clip?.startFrame ?? 0) + 15;
    expect(html).toContain(`<p data-sf-cue="${from},`);
    expect(html).toContain("Here are two recordings, cut and joined.");
    // Speech that runs past the end of the clip stops with it.
    const last = [...html.matchAll(/data-sf-cue="(\d+),(\d+)"/g)].map((m) => Number(m[2])).sort((a, b) => b - a)[0] ?? 0;
    expect(last).toBeLessThanOrEqual((clip?.startFrame ?? 0) + (clip?.durationFrames ?? 0));
    expect(result.storyboard).toMatch(/heard\s+0\.50s-3\.00s\s+Here are two recordings, cut and joined\./);
  });

  it("says so when a clip was to be captioned but nobody listened to it", () => {
    expect(check(withCaptions(), loaded({ "a.mp4": info() })).diagnostics).toEqual([
      expect.objectContaining({ code: "CAPTIONS_FAILED", severity: "error", path: "scenes[1].captions" }),
    ]);
    // A clip with no sound has nothing to caption, which is worth a note, not a failure.
    expect(check(withCaptions(), { ...loaded({ "a.mp4": info(12.4, 1920, 1080, false) }), transcripts: new Map([[1, []]]) }).diagnostics).toEqual([
      expect.objectContaining({ code: "CAPTIONS_EMPTY", severity: "warning", path: "scenes[1].captions" }),
    ]);
  });

  it("listens to exactly the part of the file that is shown, and reports a failure to", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scenefile-heard-"));
    writeFileSync(join(dir, "a.mp4"), "x");
    const asked: unknown[] = [];
    const probeClip = async (file: string) => ({ file, width: 640, height: 360, seconds: 12, audio: true });
    const good = await checkWithAssets(withCaptions(), {
      baseDir: dir,
      probeClip,
      transcribe: async (file, fromSeconds, seconds) => {
        asked.push([file.endsWith("a.mp4"), fromSeconds, seconds]);
        return heard;
      },
    });
    expect(good.ok).toBe(true);
    expect(asked).toEqual([[true, 2, 5]]);
    const bad = await checkWithAssets(withCaptions(), { baseDir: dir, probeClip, transcribe: async () => Promise.reject(new Error("The listening model is not installed. Install it once with: scenefile transcribe --install")) });
    expect(bad.diagnostics).toEqual([expect.objectContaining({ code: "CAPTIONS_FAILED", path: "scenes[1].captions" })]);
    expect(bad.diagnostics[0]?.message).toContain("scenefile transcribe --install");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("captions that cannot or should not be shown", () => {
  const said = (text: string) => new Map([[1, [{ start: 0.5, end: 3, text }]]]);
  const run = (clip: Record<string, unknown>, text = "Hello there.") =>
    check(video({ from: 2, to: 9, captions: true, ...clip }), { ...loaded({ "a.mp4": info() }), transcripts: said(text) });

  it("leaves out captions in a script the fonts cannot draw, and still makes the video", () => {
    const result = run({}, "전자 전자 전자");
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "CAPTIONS_UNDRAWABLE", severity: "warning", path: "scenes[1].captions" })]);
    expect(result.composition?.html).not.toContain("data-sf-cue");
  });

  it("shows the narrator's words, not the clip's, when a clip has both", () => {
    const result = run({ say: "A short line.", volume: 0 });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "FIELD_IGNORED", severity: "warning", path: "scenes[1].captions" })]);
    expect(result.composition?.html).not.toContain("Hello there.");
  });

  it("takes the language spoken, for when the model would guess it wrong", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scenefile-lang-"));
    writeFileSync(join(dir, "a.mp4"), "x");
    const asked: (string | undefined)[] = [];
    const sources = {
      baseDir: dir,
      probeClip: async (file: string) => ({ file, width: 640, height: 360, seconds: 12, audio: true }),
      transcribe: async (_file: string, _from: number, _seconds: number, language?: string) => {
        asked.push(language);
        return [{ start: 0.5, end: 2, text: "Привет." }];
      },
    };
    expect((await checkWithAssets(video({ captions: "ru" }), sources)).ok).toBe(true);
    expect((await checkWithAssets(video({ captions: true }), sources)).ok).toBe(true);
    expect(asked).toEqual(["ru", undefined]);
    expect(normalize(video({ captions: "russian" })).diagnostics[0]).toMatchObject({ severity: "error", path: "scenes[1].captions" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports one failure to listen once, and does not go on to make narration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scenefile-fail-"));
    writeFileSync(join(dir, "a.mp4"), "x");
    let spoken = 0;
    const result = await checkWithAssets(
      {
        version: 1,
        scenes: [
          { type: "clip", src: "a.mp4", to: 4, captions: true },
          { type: "clip", src: "a.mp4", to: 4, captions: true },
          { type: "outro", heading: "End", say: "The end." },
        ],
      },
      {
        baseDir: dir,
        probeClip: async (file: string) => ({ file, width: 640, height: 360, seconds: 12, audio: true }),
        transcribe: async () => Promise.reject(new Error("The listening model is not installed.")),
        speak: async () => {
          spoken += 1;
          return { file: "/x.wav", seconds: 1 };
        },
      },
    );
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([["CAPTIONS_FAILED", "scenes[0].captions"]]);
    expect(spoken).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("effects on a clip", () => {
  const made = (clip: Record<string, unknown>, extra: Parameters<typeof loaded>[0] = { "a.mp4": info() }, more: Record<string, unknown> = {}) =>
    check(video({ from: 2, to: 8, ...clip }), { ...loaded(extra), ...more });

  it("plays faster or slower, and lasts accordingly", () => {
    const fast = made({ speed: 2 });
    expect(fast.video?.scenes[1]?.durationFrames).toBe(90);
    expect(fast.composition?.clips?.[0]).toMatchObject({ fromSeconds: 2, seconds: 3, sourceSeconds: 6, speed: 2 });
    const slow = made({ speed: 0.5 });
    expect(slow.video?.scenes[1]?.durationFrames).toBe(360);
    expect(slow.composition?.clips?.[0]).toMatchObject({ seconds: 12, sourceSeconds: 6, speed: 0.5 });
    expect(normalize(video({ speed: 9 })).diagnostics[0]).toMatchObject({ severity: "error", path: "scenes[1].speed" });
  });

  it("moves what was heard along with the picture", () => {
    const heard = new Map([[1, [{ start: 2, end: 4, text: "Hello there." }]]]);
    const result = made({ speed: 2, captions: true }, undefined, { transcripts: heard });
    const clip = result.video?.scenes[1];
    expect(clip?.heard).toEqual([{ start: 1, end: 2, text: "Hello there." }]);
    expect(result.composition?.html).toContain(`<p data-sf-cue="${(clip?.startFrame ?? 0) + 30},`);
  });

  it("tells the renderer the exact frames a clip occupies", () => {
    const clip = made({}).video?.scenes[1];
    expect(made({}).composition?.clips?.[0]).toMatchObject({ startFrame: clip?.startFrame, frames: clip?.durationFrames });
  });

  it("needs no backdrop behind a clip that already fills the frame", () => {
    expect(made({ backdrop: "blur" }).composition?.clips?.[0]).toMatchObject({ backdrop: false, width: 1920, height: 1080 });
  });

  it("carries the looks to the renderer", () => {
    expect(made({ mono: true, zoom: "in" }).composition?.clips?.[0]).toMatchObject({ mono: true, zoom: "in", backdrop: false });
    expect(made({}).composition?.clips?.[0]).toMatchObject({ mono: false, zoom: "none", backdrop: false, speed: 1 });
  });

  it("fills the frame behind a clip that does not, when asked", () => {
    const tall = { "a.mp4": info(12.4, 1080, 1920) };
    const placed = made({ backdrop: "blur" }, tall).composition?.clips?.[0];
    // The clip stands as tall as the frame, in the middle, with its own picture blurred behind it.
    expect(placed).toMatchObject({ backdrop: true, y: 0, height: 1080 });
    expect(Math.abs((placed?.x ?? 0) + (placed?.width ?? 0) / 2 - 960)).toBeLessThanOrEqual(1);
    expect(placed?.stage).toEqual({ width: 1920, height: 1080 });
    expect(made({ backdrop: "blur", caption: "Signing in" }, tall).diagnostics).toEqual([
      expect.objectContaining({ code: "FIELD_IGNORED", severity: "warning", path: "scenes[1].caption" }),
    ]);
    expect(made({ backdrop: "blur", fit: "cover" }, tall).diagnostics).toEqual([
      expect.objectContaining({ code: "FIELD_IGNORED", severity: "warning", path: "scenes[1].backdrop" }),
    ]);
  });
});
