import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import type { Composition } from "@scenefile/engine";
import { captureFrame } from "./capture";
import { startEncoder } from "./encode";
import { probeVideo } from "./probe";
import { openComposition } from "./session";

export const QUALITIES = ["draft", "standard", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

const CRF: Record<Quality, number> = { draft: 28, standard: 20, high: 16 };

export interface RenderOptions {
  output: string;
  quality?: Quality;
  ffmpegPath?: string;
  ffprobePath?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderReport {
  output: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  elapsedMs: number;
}

/** Renders every frame of a composition to an MP4 and verifies the result with ffprobe. */
export async function renderVideo(composition: Composition, options: RenderOptions): Promise<RenderReport> {
  const started = Date.now();
  const output = resolvePath(options.output);
  const { fps, totalFrames, width, height } = composition.manifest;
  await mkdir(dirname(output), { recursive: true });

  const session = await openComposition(composition);
  try {
    const encoder = startEncoder({
      output,
      fps,
      crf: CRF[options.quality ?? "standard"],
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
    });
    try {
      for (let frame = 0; frame < totalFrames; frame++) {
        await encoder.write(await captureFrame(session.page, frame));
        options.onProgress?.(frame + 1, totalFrames);
      }
      await encoder.finish();
    } catch (cause) {
      await encoder.finish().catch(() => undefined);
      await rm(output, { force: true });
      throw cause;
    }
  } finally {
    await session.close();
  }

  const probed = await probeVideo(output, options.ffprobePath);
  if (probed.width !== width || probed.height !== height || probed.frames !== totalFrames) {
    throw new Error(
      `Rendered file does not match the composition: expected ${width}x${height} with ${totalFrames} frames, ` +
        `got ${probed.width}x${probed.height} with ${probed.frames}. Please report this at the scenefile issue tracker.`,
    );
  }

  return {
    output,
    width: probed.width,
    height: probed.height,
    fps: probed.fps,
    frames: probed.frames,
    durationSeconds: probed.durationSeconds,
    elapsedMs: Date.now() - started,
  };
}
