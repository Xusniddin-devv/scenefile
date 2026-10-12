import { execFile } from "node:child_process";
import { EnvironmentError, FFMPEG_REMEDY } from "./errors";

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  /** The color matrix the stream declares, e.g. "bt709". Empty when untagged. */
  colorSpace: string;
  colorPrimaries: string;
  colorTransfer: string;
  /** Whether the file has a sound track. */
  audio: boolean;
}

interface ProbeJson {
  streams?: { width?: number; height?: number; r_frame_rate?: string; nb_frames?: string; color_space?: string; color_primaries?: string; color_transfer?: string }[];
  format?: { duration?: string };
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (cause, stdout) => {
      if (!cause) resolve(stdout);
      else if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new EnvironmentError("ffprobe was not found.", FFMPEG_REMEDY));
      } else reject(cause);
    });
  });
}

/** Reads back what was actually written, so a render is verified rather than assumed. */
export async function probeVideo(file: string, ffprobePath = "ffprobe"): Promise<ProbeResult> {
  const stdout = await run(ffprobePath, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_frames,color_space,color_primaries,color_transfer:format=duration",
    "-of", "json", file,
  ]);
  const sound = await run(ffprobePath, [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file,
  ]);
  const json = JSON.parse(stdout) as ProbeJson;
  const stream = json.streams?.[0];
  const [numerator, denominator] = (stream?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: stream?.width ?? 0,
    height: stream?.height ?? 0,
    fps: (numerator ?? 0) / (denominator || 1),
    frames: Number(stream?.nb_frames ?? 0),
    durationSeconds: Number(json.format?.duration ?? 0),
    colorSpace: stream?.color_space ?? "",
    colorPrimaries: stream?.color_primaries ?? "",
    colorTransfer: stream?.color_transfer ?? "",
    audio: sound.trim() !== "",
  };
}
