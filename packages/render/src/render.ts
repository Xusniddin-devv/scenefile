import { rmSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { Composition } from "@scenefile/engine";
import { captureFrame } from "./capture";
import { runFfmpeg, startEncoder } from "./encode";
import { EnvironmentError, WRITE_REMEDY } from "./errors";
import { type ProbeResult, hasSound, probeVideo } from "./probe";
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
  /** Aborting this stops the render and removes what it had made so far. */
  signal?: AbortSignal;
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

/** True while a process with this id exists. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // "No such process" means it is gone; anything else (not ours to signal) means it exists.
    return (cause as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Removes scratch folders that earlier renders of this same output left behind
 * when they were killed outright. A folder is only removed if the process that
 * made it no longer exists.
 */
async function sweepStale(output: string): Promise<void> {
  const prefix = `.${basename(output)}.partial-`;
  for (const name of await readdir(dirname(output))) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length));
    if (Number.isInteger(pid) && pid !== process.pid && !isRunning(pid)) {
      await rm(join(dirname(output), name), { recursive: true, force: true });
    }
  }
}

/** Joins encoded segments end to end without re-encoding them. */
async function joinSegments(segments: readonly Segment[], scratch: string, target: string, ffmpegPath?: string): Promise<void> {
  const list = join(scratch, "segments.txt");
  // Bare file names, read relative to the list itself: whatever characters the
  // output's folder has in its name never reach the list.
  await writeFile(list, segments.map((segment) => `file '${basename(segment.file)}'\n`).join(""));
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
  const asked = options.workers !== undefined && Number.isFinite(options.workers) ? options.workers : defaultWorkers();
  const workers = Math.max(1, Math.min(Math.floor(asked), MAX_WORKERS, segments.length));

  // Music is checked before a single frame is drawn: finding out afterwards
  // that it cannot be used would waste the whole render.
  if (composition.audio && !(await hasSound(composition.audio.file, options.ffprobePath))) {
    throw new EnvironmentError(
      `The music file "${composition.audio.file}" has no sound that ffmpeg can read.`,
      "Use a different music file, or convert this one to MP3 or WAV.",
    );
  }

  try {
    await mkdir(dirname(output), { recursive: true });
    await sweepStale(output);
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch);
  } catch (cause) {
    throw unwritable(output, cause);
  }
  // If the process is ended from outside, `finally` does not run, but "exit"
  // does. Removing a folder then has to be synchronous.
  const removeOnExit = (): void => rmSync(scratch, { recursive: true, force: true });
  process.once("exit", removeOnExit);

  let probed: ProbeResult;
  try {
    const queue = [...segments];
    let done = 0;
    let stopped = options.signal?.aborted ?? false;
    options.signal?.addEventListener("abort", () => {
      stopped = true;
    });

    /** One worker: its own browser, taking segments until none are left or another worker has failed. */
    const work = async (): Promise<void> => {
      const session = await openComposition(composition);
      try {
        for (let segment = queue.shift(); segment && !stopped; segment = queue.shift()) {
          const range = `frames ${segment.from} to ${segment.to - 1}`;
          const encoder = startEncoder({
            output: segment.file,
            fps,
            crf: CRF[options.quality ?? "standard"],
            ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
          });
          try {
            for (let frame = segment.from; frame < segment.to && !stopped; frame++) {
              const picture = await captureFrame(session.page, frame).catch((cause: unknown) => {
                // The browser closing or crashing is the machine's doing, not the scenefile's.
                const reason = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
                throw new EnvironmentError(
                  `The browser stopped while drawing ${range} (at frame ${frame}): ${reason}`,
                  "Render again. If it happens again, use fewer workers (--workers 1) or close other programs to free memory.",
                );
              });
              await encoder.write(picture);
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
    if (options.signal?.aborted) {
      throw new EnvironmentError("The render was cancelled.", "Start it again if you still want the video.");
    }
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
    const seconds = totalFrames / fps;
    const clips = composition.clips ?? [];
    if (clips.length > 0) {
      // The person's footage is laid over the places the page kept for it. Each clip is brought to
      // the video's frame rate and colour, sized to its rectangle, and shown for exactly its scene.
      finished = join(scratch, "with-clips.mp4");
      const inputs: string[] = [];
      const filters: string[] = [];
      let base = "0:v";
      for (const [index, clip] of clips.entries()) {
        inputs.push("-protocol_whitelist", "file", "-ss", clip.fromSeconds.toFixed(3), "-t", clip.seconds.toFixed(3), "-i", clip.file);
        const size = clip.cover
          ? `scale=${clip.width}:${clip.height}:force_original_aspect_ratio=increase:out_color_matrix=bt709:out_range=tv,crop=${clip.width}:${clip.height}`
          : `scale=${clip.width}:${clip.height}:out_color_matrix=bt709:out_range=tv`;
        const until = clip.atSeconds + clip.seconds - 0.5 / fps;
        filters.push(
          `[${index + 1}:v]fps=${fps},${size},setsar=1,format=yuv420p,setpts=PTS-STARTPTS+${clip.atSeconds.toFixed(6)}/TB[clip${index}]`,
          `[${base}][clip${index}]overlay=${clip.x}:${clip.y}:eof_action=pass:enable='between(t,${clip.atSeconds.toFixed(6)},${until.toFixed(6)})'[over${index}]`,
        );
        base = `over${index}`;
      }
      await runFfmpeg(
        [
          "-i", picture,
          ...inputs,
          "-filter_complex", `${filters.join(";")};[${base}]setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[out]`,
          "-map", "[out]", "-an",
          "-c:v", "libx264", "-threads", "4", "-crf", String(CRF[options.quality ?? "standard"]), "-pix_fmt", "yuv420p",
          "-frames:v", String(totalFrames),
          "-movflags", "+faststart",
          finished,
        ],
        options.ffmpegPath,
      );
      const laid = await probeVideo(finished, options.ffprobePath);
      if (laid.frames !== totalFrames || laid.width !== width || laid.height !== height) {
        throw new Error(`Laying in the clips changed the video: expected ${totalFrames} frames at ${width}x${height}, got ${laid.frames} at ${laid.width}x${laid.height}.`);
      }
    }

    const lines = composition.narration ?? [];
    const heard = clips.filter((clip) => clip.volume > 0);
    if (composition.audio || lines.length > 0 || heard.length > 0) {
      const silent = finished;
      finished = join(scratch, "with-sound.mp4");
      const inputs: string[] = [];
      const filters: string[] = [];
      /** The tracks added together at the end. */
      const tracks: string[] = [];
      const SHAPE = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
      let next = 1;
      if (composition.audio) {
        const fadeOut = Math.min(MUSIC_FADE_OUT_SECONDS, seconds / 3);
        // The music is repeated without end and then cut to the picture's length.
        // It may only be read as a file: nothing inside it can point ffmpeg elsewhere.
        inputs.push("-protocol_whitelist", "file", "-stream_loop", "-1", "-i", composition.audio.file);
        filters.push(
          `[${next}:a]${SHAPE},volume=${composition.audio.volume},afade=t=in:st=0:d=${MUSIC_FADE_IN_SECONDS},` +
            `afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[music]`,
        );
        next += 1;
      }
      for (const [index, line] of lines.entries()) {
        inputs.push("-protocol_whitelist", "file", "-i", line.file);
        filters.push(
          `[${next}:a]${SHAPE},volume=6.5dB,alimiter=limit=0.8:level=disabled,adelay=${Math.round(line.atSeconds * 1000)}:all=1[line${index}]`,
        );
        next += 1;
      }
      if (lines.length > 0) {
        const all = lines.map((_, index) => `[line${index}]`).join("");
        // Lines never overlap, so adding them needs no levelling.
        filters.push(`${all}amix=inputs=${lines.length}:normalize=0:dropout_transition=0[voice]`);
      }
      if (composition.audio && lines.length > 0) {
        // The music gives way while someone is speaking and comes back after.
        filters.push("[voice]asplit=2[said][key]", "[music][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=900[bed]");
        tracks.push("[bed]", "[said]");
      } else if (composition.audio) tracks.push("[music]");
      else if (lines.length > 0) tracks.push("[voice]");
      for (const [index, clip] of heard.entries()) {
        // The clip's own sound, for the part of it that is shown, starting when it does.
        inputs.push("-protocol_whitelist", "file", "-ss", clip.fromSeconds.toFixed(3), "-t", clip.seconds.toFixed(3), "-i", clip.file);
        // Sound cut from the middle of a file keeps the file's clock; it is restarted from zero before being placed.
        filters.push(`[${next}:a]asetpts=PTS-STARTPTS,${SHAPE},volume=${clip.volume},adelay=${Math.round(clip.atSeconds * 1000)}:all=1[heard${index}]`);
        tracks.push(`[heard${index}]`);
        next += 1;
      }
      // Added together as they are, then padded with silence to the picture's length.
      // A single track is used as it is: the mixer misorders one that starts late on its own.
      const together = tracks.length === 1 ? `${tracks[0]}anull` : `${tracks.join("")}amix=inputs=${tracks.length}:normalize=0:dropout_transition=0`;
      filters.push(`${together},apad[sound]`);
      await runFfmpeg(
        [
          "-i", silent,
          ...inputs,
          "-filter_complex", filters.join(";"),
          "-map", "0:v:0", "-map", "[sound]",
          // Stereo at 48 kHz, whatever the source was: what players and upload sites expect.
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
          "-t", seconds.toFixed(3),
          "-movflags", "+faststart",
          finished,
        ],
        options.ffmpegPath,
      );
      const mixed = await probeVideo(finished, options.ffprobePath);
      if (!mixed.audio || mixed.frames !== totalFrames) {
        throw new Error(
          `Mixing in the sound changed the video: expected ${totalFrames} frames with sound, ` +
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
    process.removeListener("exit", removeOnExit);
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
    audio:
      Boolean(composition.audio) ||
      (composition.narration?.length ?? 0) > 0 ||
      (composition.clips ?? []).some((clip) => clip.volume > 0),
  };
}
