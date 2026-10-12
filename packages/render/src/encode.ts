import { spawn } from "node:child_process";
import { once } from "node:events";
import { ENCODE_REMEDY, EnvironmentError, FFMPEG_REMEDY } from "./errors";

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
      "-c:v", "libx264", "-crf", String(options.crf),
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
