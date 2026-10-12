import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Composition, check } from "@scenefile/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { EnvironmentError, captureFrame, defaultWorkers, openComposition, probeVideo, renderVideo } from "../src/index";

function fixture(): Composition {
  const result = check({
    version: 1,
    transition: "fade",
    format: "square-1080p",
    scenes: [
      { type: "title", heading: "Ship faster", sub: "A CLI", duration: 1.5 },
      { type: "terminal", steps: [{ run: "npx x", output: "ok" }], duration: 2 },
    ],
  });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-render-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for ffmpeg that behaves as the given shell script. */
function fakeFfmpeg(name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return path;
}

function partialFiles(folder: string): string[] {
  return readdirSync(folder).filter((name) => name.includes("partial"));
}

describe("runtime bundle", () => {
  it("is small, which proves neither zod nor the syntax highlighter was bundled into the page", () => {
    const bundle = createRequire(import.meta.url).resolve("@scenefile/runtime/bundle");
    expect(statSync(bundle).size).toBeLessThan(30_000);
    expect(readFileSync(bundle, "utf8")).toContain("__scenefile");
  });
});

describe("openComposition", () => {
  it("exposes seek and the frame count, and shows exactly one scene per frame", async () => {
    const composition = fixture();
    const session = await openComposition(composition);
    try {
      const total = await session.page.evaluate(
        () => (window as unknown as { __scenefile: { totalFrames: number } }).__scenefile.totalFrames,
      );
      expect(total).toBe(composition.manifest.totalFrames);
      for (const frame of [0, 44, 45, total - 1]) {
        await captureFrame(session.page, frame);
        const visible = await session.page.evaluate(
          () => document.querySelectorAll(".sf-scene:not([hidden])").length,
        );
        expect(visible).toBe(1);
      }
    } finally {
      await session.close();
    }
  });

  it("produces identical pixels for a frame regardless of the frames visited before it", async () => {
    // Chromium carries paint state between frames, so a weak version of this test
    // (few frames, one revisit order) passes by luck. Thirty frames across three
    // scenes, each revisited three times in different shuffled orders, does not.
    const result = check({
      version: 1,
      scenes: [
        { type: "title", heading: "Video from JSON", sub: "Any model can write a scenefile.", duration: 1.6 },
        {
          type: "terminal",
          steps: [{ run: "scenefile check a.json", output: "No problems found." }, { run: "🚀 go" }],
          duration: 3,
        },
        { type: "title", heading: "No keyframes. No pixels.", duration: 1.5 },
      ],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const total = result.composition.manifest.totalFrames;
    const frames = Array.from({ length: 30 }, (_, i) => Math.round((i * (total - 1)) / 29));

    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const shuffled = (): number[] => {
      const order = frames.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const a = order[i];
        const b = order[j];
        if (a === undefined || b === undefined) throw new Error("bad index");
        order[i] = b;
        order[j] = a;
      }
      return order;
    };

    const session = await openComposition(result.composition);
    try {
      const sequential: Buffer[] = [];
      for (const frame of frames) sequential.push(await captureFrame(session.page, frame));
      const mismatched = new Set<number>();
      for (let pass = 0; pass < 3; pass++) {
        for (const i of shuffled()) {
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

  it("draws text in the bundled fonts, including Cyrillic", async () => {
    const result = check({
      version: 1,
      scenes: [{ type: "title", heading: "Привет", sub: "one two three four five six" }],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const session = await openComposition(result.composition);
    try {
      await captureFrame(session.page, 40);
      const fonts = await session.page.evaluate(() => {
        const heading = document.querySelector(".sf-title__heading");
        return {
          loaded: Array.from(document.fonts, (face) => `${face.family}:${face.status}`),
          family: heading ? getComputedStyle(heading).fontFamily : "",
          cyrillicOk: document.fonts.check('900 40px "Onest"', "Привет"),
          // Text drawn from the bundled font is equally wide whatever the fallback is.
          // If a glyph is missing, the fallback draws it and the two widths differ.
          drifts: ["Onest", "Cascadia Code"].map((family) => {
            const width = (fallback: string): number => {
              const span = document.createElement("span");
              span.style.cssText = `position:absolute;white-space:pre;font:400 80px "${family}",${fallback}`;
              span.textContent = "қишлоқ ҳаёти ғоя Oʻzbekiston Привет ўзбек";
              document.body.append(span);
              const measured = span.getBoundingClientRect().width;
              span.remove();
              return measured;
            };
            return Math.abs(width("serif") - width("monospace"));
          }),
        };
      });
      expect(fonts.drifts).toEqual([0, 0]);
      expect(fonts.family).toContain("Onest");
      expect(fonts.cyrillicOk).toBe(true);
      expect(fonts.loaded.length).toBeGreaterThanOrEqual(3);
      expect(fonts.loaded.every((entry) => entry.endsWith(":loaded"))).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("wraps long commands and long words instead of clipping them", async () => {
    const result = check({
      version: 1,
      scenes: [
        { type: "title", heading: "Supercalifragilisticexpialidocious".repeat(2), sub: "x" },
        { type: "terminal", steps: [{ run: "x".repeat(120), output: "y".repeat(200) }] },
      ],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const session = await openComposition(result.composition);
    try {
      for (const scene of result.composition.manifest.scenes) {
        await captureFrame(session.page, scene.startFrame + scene.durationFrames - scene.exitFrames - 1);
        const overflow = await session.page.evaluate(() => {
          const visible = document.querySelector(".sf-scene:not([hidden])");
          if (!visible) return Number.POSITIVE_INFINITY;
          let worst = 0;
          for (const el of visible.querySelectorAll(".sf-title__heading, [data-sf-type], [data-sf-out]")) {
            const frame = el.closest(".sf-terminal__window") ?? document.documentElement;
            const limit = frame.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            worst = Math.max(worst, box.right - limit.right, box.bottom - limit.bottom);
          }
          return worst;
        });
        expect(overflow, `scene ${scene.index} (${scene.type})`).toBeLessThanOrEqual(0.5);
      }
    } finally {
      await session.close();
    }
  });

  it("draws something: an early frame and a mid frame differ", async () => {
    const session = await openComposition(fixture());
    try {
      const blank = await captureFrame(session.page, 0);
      const full = await captureFrame(session.page, 30);
      expect(blank.equals(full)).toBe(false);
    } finally {
      await session.close();
    }
  });
});

describe("renderVideo", () => {
  it("writes an MP4 whose stream matches the composition, creating the output directory", async () => {
    const composition = fixture();
    const output = join(dir, "nested", "deeper", "out.mp4");
    const progress: number[] = [];
    const report = await renderVideo(composition, {
      output,
      quality: "draft",
      onProgress: (done) => progress.push(done),
    });

    expect(existsSync(output)).toBe(true);
    expect(report).toMatchObject({
      output,
      width: 1080,
      height: 1080,
      fps: 30,
      frames: composition.manifest.totalFrames,
    });
    expect(report.durationSeconds).toBeCloseTo(composition.manifest.totalFrames / 30, 1);
    expect(progress.at(-1)).toBe(composition.manifest.totalFrames);

    const probed = await probeVideo(output);
    expect(probed.frames).toBe(composition.manifest.totalFrames);
    expect(probed).toMatchObject({ colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "bt709" });
    expect(partialFiles(join(dir, "nested", "deeper"))).toEqual([]);
  });

  it("makes the same video whatever the number of workers", async () => {
    // Seven seconds: two segments, so two workers each take one.
    const result = check({
      version: 1,
      transition: "push",
      format: "square-1080p",
      scenes: [
        { type: "title", heading: "Segments one two three", sub: "four five six", duration: 3.5 },
        { type: "terminal", steps: [{ run: "echo parallel", output: "ok" }], duration: 4 },
      ],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const total = result.composition.manifest.totalFrames;
    expect(total).toBeGreaterThan(150);
    expect(total).toBeLessThanOrEqual(300);

    const frameHashes = (file: string): string =>
      execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-f", "framemd5", "-"], { encoding: "utf8" });
    const one = join(dir, "one-worker.mp4");
    // A folder name with a quote, a space and a line break: the list of segments must cope.
    const two = join(dir, "it's odd\nhere", "two-workers.mp4");
    const reportOne = await renderVideo(result.composition, { output: one, quality: "draft", workers: 1 });
    const reportTwo = await renderVideo(result.composition, { output: two, quality: "draft", workers: 2 });

    expect(reportOne).toMatchObject({ workers: 1, frames: total, audio: false });
    expect(reportTwo).toMatchObject({ workers: 2, frames: total, audio: false });
    expect(frameHashes(two)).toBe(frameHashes(one));
    expect(readFileSync(two).equals(readFileSync(one))).toBe(true);
    expect(partialFiles(dir)).toEqual([]);
    expect(partialFiles(join(dir, "it's odd\nhere"))).toEqual([]);
  });

  it("stops when told to, leaving nothing behind", async () => {
    const stopper = new AbortController();
    const output = join(dir, "cancelled.mp4");
    const attempt = renderVideo(fixture(), {
      output,
      quality: "draft",
      signal: stopper.signal,
      onProgress: (done) => {
        if (done === 10) stopper.abort();
      },
    });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toThrow(/cancelled/);
    expect(existsSync(output)).toBe(false);
    expect(partialFiles(dir)).toEqual([]);
  });

  it("does not start further segments once one has failed", async () => {
    // Four segments, two workers. The first segment's encoder dies at once; segments three and four must never begin.
    const result = check({
      version: 1,
      transition: "cut",
      scenes: Array.from({ length: 4 }, (_, i) => ({ type: "title", heading: `Part ${i} one two three`, duration: 5 })),
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.composition.manifest.totalFrames).toBe(600);
    const log = join(dir, "encoders.log");
    const ffmpegPath = fakeFfmpeg(
      "ffmpeg-first-dies",
      `echo "$*" >> "${log}"; case "$*" in *00000.mp4*) echo "first segment failed" >&2; exit 4;; *) exec ffmpeg "$@";; esac`,
    );
    const attempt = renderVideo(result.composition, { output: join(dir, "stops.mp4"), ffmpegPath, quality: "draft", workers: 2 });
    await expect(attempt).rejects.toThrow(/first segment failed/);
    const started = readFileSync(log, "utf8");
    expect(started).toContain("00000.mp4");
    expect(started).not.toContain("00002.mp4");
    expect(started).not.toContain("00003.mp4");
    expect(partialFiles(dir)).toEqual([]);
  });

  it("clears away what an interrupted render of the same file left behind, but not a render still running", async () => {
    const output = join(dir, "swept.mp4");
    const stale = join(dir, ".swept.mp4.partial-999999999");
    const running = join(dir, `.swept.mp4.partial-${process.ppid}`);
    mkdirSync(stale);
    mkdirSync(running);
    writeFileSync(join(stale, "00000.mp4"), "left over");
    await renderVideo(fixture(), { output, quality: "draft" });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(running)).toBe(true);
    rmSync(running, { recursive: true });
  });

  it("treats a worker count that is not a number as no preference", async () => {
    const report = await renderVideo(fixture(), { output: join(dir, "nan.mp4"), quality: "draft", workers: Number.NaN });
    expect(report.workers).toBeGreaterThanOrEqual(1);
  });

  it("never uses more workers than there are segments to render", async () => {
    const report = await renderVideo(fixture(), { output: join(dir, "capped.mp4"), quality: "draft", workers: 6 });
    expect(report.workers).toBe(1);
    expect(defaultWorkers()).toBeGreaterThanOrEqual(1);
    expect(defaultWorkers()).toBeLessThanOrEqual(4);
  });

  it("stops every worker and leaves nothing behind when one encoder dies", async () => {
    const result = check({
      version: 1,
      scenes: [{ type: "title", heading: "one two three", duration: 6 }, { type: "title", heading: "four five six", duration: 6 }],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, "dies.mp4");
    writeFileSync(output, "KEEP");
    // Fails only for the second segment, so one worker succeeds while another fails.
    const ffmpegPath = fakeFfmpeg(
      "ffmpeg-second-dies",
      'case "$*" in *00001.mp4*) head -c 2000 >/dev/null; echo "segment two failed" >&2; exit 4;; *) exec ffmpeg "$@";; esac',
    );
    const attempt = renderVideo(result.composition, { output, ffmpegPath, quality: "draft", workers: 2 });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toThrow(/segment two failed/);
    expect(readFileSync(output, "utf8")).toBe("KEEP");
    expect(partialFiles(dir)).toEqual([]);
  });

  it("keeps an existing file at the output path when encoding fails, and reports why", async () => {
    const output = join(dir, "keep.mp4");
    writeFileSync(output, "KEEP");
    const ffmpegPath = fakeFfmpeg("ffmpeg-dies", 'head -c 2000 >/dev/null; echo "boom from encoder" >&2; exit 3');
    const attempt = renderVideo(fixture(), { output, ffmpegPath });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toThrow(/boom from encoder/);
    expect(readFileSync(output, "utf8")).toBe("KEEP");
    expect(partialFiles(dir)).toEqual([]);
  });

  it("reports an unwritable output location as an environment problem", async () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const attempt = renderVideo(fixture(), { output: join(blocker, "sub", "out.mp4") });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toThrow(/Cannot write/);
  });

  it("fails with an EnvironmentError and leaves the output path untouched when ffmpeg is missing", async () => {
    const output = join(dir, "missing-ffmpeg.mp4");
    writeFileSync(output, "KEEP");
    const attempt = renderVideo(fixture(), { output, ffmpegPath: "/nonexistent/ffmpeg" });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toMatchObject({ remedy: expect.stringContaining("ffmpeg") });
    expect(readFileSync(output, "utf8")).toBe("KEEP");
    expect(partialFiles(dir)).toEqual([]);
  });
});
