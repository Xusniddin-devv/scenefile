import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { Composition } from "@scenefile/engine";
import { captureFrame } from "./capture";
import { runFfmpeg, startEncoder } from "./encode";
import { EnvironmentError, WRITE_REMEDY } from "./errors";
import { type ProbeResult, probeVideo } from "./probe";
import { openComposition } from "./session";

export const QUALITIES = ["draft", "standard", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

const CRF: Record<Quality, number> = { draft: 28, standard: 20, high: 16 };

/**
 * The video is rendered in segments of this length, each encoded on its own
 * and then joined. The length is fixed rather than derived from the number of
 * workers, so the finished file is the same however many workers made it.
 */
export const SEGMENT_SECONDS = 5;
export const MAX_WORKERS = 8;
/** The music comes up and goes down rather than starting and stopping dead. */
const MUSIC_FADE_IN_SECONDS = 0.5;
const MUSIC_FADE_OUT_SECONDS = 1.5;

/**
 * Each worker runs its own browser. Measured: capture speeds up until about
 * half the cores are busy and gets slower beyond that.
 */
export function defaultWorkers(): number {
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
}

export interface RenderOptions {
  output: string;
  quality?: Quality;
  /** Browsers to render with at once. Defaults to half the cores, at most four. */
  workers?: number;
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
  workers: number;
  /** Whether the file has a sound track. */
  audio: boolean;
}

interface Segment {
  from: number;
  to: number;
  file: string;
}

function unwritable(output: string, cause: unknown): EnvironmentError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new EnvironmentError(`Cannot write the video to "${output}": ${reason}`, WRITE_REMEDY);
}

/** Joins encoded segments end to end without re-encoding them. */
async function joinSegments(segments: readonly Segment[], scratch: string, target: string, ffmpegPath?: string): Promise<void> {
  const list = join(scratch, "segments.txt");
  // The concat list quotes each path; a quote inside a path is closed, escaped, and reopened.
  await writeFile(list, segments.map((segment) => `file '${segment.file.replace(/'/g, "'\\''")}'\n`).join(""));
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", target], ffmpegPath);
}

/**
 * Renders every frame of a composition to an MP4 and verifies the result with ffprobe.
 *
 * Everything is built in a scratch folder beside the output and moved into
 * place only once it is complete and verified. Whatever was at the output path
 * before is untouched by a failed or interrupted render, and a file at the
 * output path always means a finished video.
 */
export async function renderVideo(composition: Composition, options: RenderOptions): Promise<RenderReport> {
  const started = Date.now();
  const output = resolvePath(options.output);
  const scratch = join(dirname(output), `.${basename(output)}.partial-${process.pid}`);
  const { fps, totalFrames, width, height } = composition.manifest;

  const perSegment = SEGMENT_SECONDS * fps;
  const segments: Segment[] = Array.from({ length: Math.ceil(totalFrames / perSegment) }, (_, index) => ({
    from: index * perSegment,
    to: Math.min(totalFrames, (index + 1) * perSegment),
    file: join(scratch, `${String(index).padStart(5, "0")}.mp4`),
  }));
  const workers = Math.max(1, Math.min(Math.floor(options.workers ?? defaultWorkers()), MAX_WORKERS, segments.length));

  try {
    await mkdir(dirname(output), { recursive: true });
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch);
  } catch (cause) {
    throw unwritable(output, cause);
  }

  let probed: ProbeResult;
  try {
    const queue = [...segments];
    let done = 0;
    let stopped = false;

    /** One worker: its own browser, taking segments until none are left or another worker has failed. */
    const work = async (): Promise<void> => {
      const session = await openComposition(composition);
      try {
        for (let segment = queue.shift(); segment && !stopped; segment = queue.shift()) {
          const encoder = startEncoder({
            output: segment.file,
            fps,
            crf: CRF[options.quality ?? "standard"],
            ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
          });
          try {
            for (let frame = segment.from; frame < segment.to && !stopped; frame++) {
              await encoder.write(await captureFrame(session.page, frame));
              done += 1;
              options.onProgress?.(done, totalFrames);
            }
            await encoder.finish();
          } catch (cause) {
            await encoder.finish().catch(() => undefined);
            throw cause;
          }
        }
      } finally {
        await session.close();
      }
    };

    const outcomes = await Promise.allSettled(
      Array.from({ length: workers }, () =>
        work().catch((cause: unknown) => {
          stopped = true;
          throw cause;
        }),
      ),
    );
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason as unknown] : []));
    if (failures.length > 0) {
      // A problem with the machine is the more useful thing to report than whatever it caused elsewhere.
      throw failures.find((failure) => failure instanceof EnvironmentError) ?? failures[0];
    }

    const picture = join(scratch, "picture.mp4");
    const [only] = segments;
    if (segments.length === 1 && only) await rename(only.file, picture);
    else await joinSegments(segments, scratch, picture, options.ffmpegPath);

    probed = await probeVideo(picture, options.ffprobePath);
    if (probed.width !== width || probed.height !== height || probed.frames !== totalFrames) {
      throw new Error(
        `Rendered file does not match the composition: expected ${width}x${height} with ${totalFrames} frames, ` +
          `got ${probed.width}x${probed.height} with ${probed.frames}.`,
      );
    }

    let finished = picture;
    if (composition.audio) {
      finished = join(scratch, "with-music.mp4");
      const seconds = totalFrames / fps;
      const fadeOut = Math.min(MUSIC_FADE_OUT_SECONDS, seconds / 3);
      const filter =
        `[1:a]volume=${composition.audio.volume},afade=t=in:st=0:d=${MUSIC_FADE_IN_SECONDS},` +
        `afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[music]`;
      await runFfmpeg(
        [
          "-i", picture,
          // The music is repeated without end and then cut to the picture's length.
          "-stream_loop", "-1", "-i", composition.audio.file,
          "-filter_complex", filter,
          "-map", "0:v:0", "-map", "[music]",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
          "-t", seconds.toFixed(3),
          "-movflags", "+faststart",
          finished,
        ],
        options.ffmpegPath,
      );
      const mixed = await probeVideo(finished, options.ffprobePath);
      if (!mixed.audio || mixed.frames !== totalFrames) {
        throw new Error(
          `Mixing in the music changed the video: expected ${totalFrames} frames with sound, ` +
            `got ${mixed.frames}${mixed.audio ? "" : " without sound"}.`,
        );
      }
    }
    try {
      await rename(finished, output);
    } catch (cause) {
      throw unwritable(output, cause);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  return {
    output,
    width: probed.width,
    height: probed.height,
    fps: probed.fps,
    frames: probed.frames,
    durationSeconds: probed.durationSeconds,
    elapsedMs: Date.now() - started,
    workers,
    audio: Boolean(composition.audio),
  };
}
