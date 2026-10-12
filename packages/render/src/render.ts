import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { Composition } from "@scenefile/engine";
import { captureFrame } from "./capture";
import { startEncoder } from "./encode";
import { EnvironmentError, WRITE_REMEDY } from "./errors";
import { type ProbeResult, probeVideo } from "./probe";
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

function unwritable(output: string, cause: unknown): EnvironmentError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new EnvironmentError(`Cannot write the video to "${output}": ${reason}`, WRITE_REMEDY);
}

/**
 * Renders every frame of a composition to an MP4 and verifies the result with ffprobe.
 *
 * The video is encoded to a temporary file beside the output and moved into
 * place only once it is complete and verified. Whatever was at the output path
 * before is untouched by a failed or interrupted render, and a file at the
 * output path always means a finished video.
 */
export async function renderVideo(composition: Composition, options: RenderOptions): Promise<RenderReport> {
  const started = Date.now();
  const output = resolvePath(options.output);
  const temp = join(dirname(output), `.${basename(output)}.partial-${process.pid}.mp4`);
  const { fps, totalFrames, width, height } = composition.manifest;
  try {
    await mkdir(dirname(output), { recursive: true });
  } catch (cause) {
    throw unwritable(output, cause);
  }

  let probed: ProbeResult;
  try {
    const session = await openComposition(composition);
    try {
      const encoder = startEncoder({
        output: temp,
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
        throw cause;
      }
    } finally {
      await session.close();
    }

    probed = await probeVideo(temp, options.ffprobePath);
    if (probed.width !== width || probed.height !== height || probed.frames !== totalFrames) {
      throw new Error(
        `Rendered file does not match the composition: expected ${width}x${height} with ${totalFrames} frames, ` +
          `got ${probed.width}x${probed.height} with ${probed.frames}.`,
      );
    }
    try {
      await rename(temp, output);
    } catch (cause) {
      throw unwritable(output, cause);
    }
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
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
