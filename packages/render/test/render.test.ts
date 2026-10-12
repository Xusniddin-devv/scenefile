import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Composition, check } from "@scenefile/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EnvironmentError, captureFrame, openComposition, probeVideo, renderVideo } from "../src/index";

function fixture(): Composition {
  const result = check({
    version: 1,
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

describe("runtime bundle", () => {
  it("is small, which proves zod was not bundled into the page", () => {
    const bundle = createRequire(import.meta.url).resolve("@scenefile/runtime/bundle");
    expect(statSync(bundle).size).toBeLessThan(20_000);
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
  });

  it("fails with an EnvironmentError and leaves no file when ffmpeg is missing", async () => {
    const output = join(dir, "missing-ffmpeg.mp4");
    const attempt = renderVideo(fixture(), { output, ffmpegPath: "/nonexistent/ffmpeg" });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toMatchObject({ remedy: expect.stringContaining("ffmpeg") });
    expect(existsSync(output)).toBe(false);
  });
});
