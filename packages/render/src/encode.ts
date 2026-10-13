import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { ENCODE_REMEDY, EnvironmentError, FFMPEG_REMEDY } from "./errors";

/** Runs ffmpeg to completion. A missing binary or a non-zero exit is an environment problem, with ffmpeg's own words. */
export function runFfmpeg(
  args: string[],
  ffmpegPath = "ffmpeg",
  /** Stops ffmpeg when aborted, or when it has run longer than it should. */
  limits: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = { ...(limits.signal ? { signal: limits.signal } : {}), ...(limits.timeoutMs ? { timeout: Math.ceil(limits.timeoutMs) } : {}) };
    execFile(ffmpegPath, ["-y", "-loglevel", "error", ...args], options, (cause, _stdout, stderr) => {
      if (!cause) resolve();
      else if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new EnvironmentError("ffmpeg was not found.", FFMPEG_REMEDY));
      } else if (limits.signal?.aborted) {
        reject(new EnvironmentError("The render was cancelled.", "Start it again if you still want the video."));
      } else if ((cause as { killed?: boolean }).killed) {
        reject(new EnvironmentError("ffmpeg ran far longer than this video should take and was stopped.", "Check the clips: one of them may be damaged or far larger than it looks."));
      } else {
        reject(new EnvironmentError(`ffmpeg failed: ${stderr.trim().slice(-2000) || cause.message}`, ENCODE_REMEDY));
      }
    });
  });
}

export interface Encoder {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
}

/** Starts ffmpeg reading PNG frames on stdin and writing H.264 to `output`. */
export function startEncoder(options: { output: string; fps: number; crf: number; ffmpegPath?: string }): Encoder {
  const child = spawn(
    options.ffmpegPath ?? "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(options.fps), "-c:v", "png", "-i", "-",
      // Browsers draw in sRGB. Convert with the BT.709 matrix and say so in the
      // stream; untagged HD video is assumed to be BT.709 by players, and
      // ffmpeg's default conversion is not, which shifts every color.
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
        "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
      // A fixed thread count: several encoders run at once, and for a given
      // ffmpeg build the encoded bytes then do not vary with the number of cores.
      "-c:v", "libx264", "-threads", "2", "-crf", String(options.crf),
      "-movflags", "+faststart",
      options.output,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-2000);
  });

  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", (cause: NodeJS.ErrnoException) => {
      reject(cause.code === "ENOENT" ? new EnvironmentError("ffmpeg was not found.", FFMPEG_REMEDY) : cause);
    });
    child.on("close", (code, signal) => {
      if (code === 0) return resolve();
      const how = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
      const detail = stderr.trim();
      reject(new EnvironmentError(`ffmpeg ${how}${detail ? `: ${detail}` : "."}`, ENCODE_REMEDY));
    });
  });
  // Remember a failure so the next write() reports it instead of feeding a dead process.
  let failure: unknown;
  exited.catch((cause: unknown) => {
    failure = cause;
  });
  // A broken pipe is reported through `exited` with ffmpeg's own message.
  child.stdin.on("error", () => undefined);

  return {
    async write(frame) {
      if (failure !== undefined) throw failure;
      if (child.stdin.write(frame)) return;
      // If the pipe breaks while waiting, report why ffmpeg ended rather than the broken pipe.
      await Promise.race([once(child.stdin, "drain").catch(() => exited), exited]);
    },
    async finish() {
      child.stdin.end();
      await exited;
    },
  };
}
