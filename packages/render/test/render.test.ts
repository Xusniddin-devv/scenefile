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
    const session = await openComposition(fixture());
    try {
      const frames = [0, 10, 30, 50, 80, 104];
      const sequential: Buffer[] = [];
      for (const frame of frames) sequential.push(await captureFrame(session.page, frame));
      for (const i of [4, 1, 5, 0, 3, 2]) {
        const frame = frames[i];
        const expected = sequential[i];
        if (frame === undefined || !expected) throw new Error("bad index");
        const again = await captureFrame(session.page, frame);
        expect(again.equals(expected), `frame ${frame}`).toBe(true);
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
  });

  it("fails with an EnvironmentError and leaves no file when ffmpeg is missing", async () => {
    const output = join(dir, "missing-ffmpeg.mp4");
    const attempt = renderVideo(fixture(), { output, ffmpegPath: "/nonexistent/ffmpeg" });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toMatchObject({ remedy: expect.stringContaining("ffmpeg") });
    expect(existsSync(output)).toBe(false);
  });
});
