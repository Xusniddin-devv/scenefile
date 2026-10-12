import { spawn } from "node:child_process";
import { once } from "node:events";
import { EnvironmentError, FFMPEG_REMEDY } from "./errors";

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
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(options.crf),
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
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
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
      if (!child.stdin.write(frame)) await Promise.race([once(child.stdin, "drain"), exited]);
    },
    async finish() {
      child.stdin.end();
      await exited;
    },
  };
}
