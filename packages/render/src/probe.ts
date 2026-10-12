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

/**
 * True when a file has a sound track ffmpeg can read. False for a missing or
 * unreadable file, or one that is not media at all. A missing ffprobe is still
 * an environment problem and is thrown.
 */
export async function hasSound(file: string, ffprobePath = "ffprobe"): Promise<boolean> {
  try {
    const found = await run(ffprobePath, [
      "-v", "error", "-protocol_whitelist", "file", "-select_streams", "a:0",
      "-show_entries", "stream=codec_name", "-of", "csv=p=0", file,
    ]);
    return found.trim() !== "";
  } catch (cause) {
    if (cause instanceof EnvironmentError) throw cause;
    return false;
  }
}

/** Reads back what was actually written, so a render is verified rather than assumed. */
export async function probeVideo(file: string, ffprobePath = "ffprobe"): Promise<ProbeResult> {
  const stdout = await run(ffprobePath, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_frames,color_space,color_primaries,color_transfer:format=duration",
    "-of", "json", file,
  ]);
  const audio = await hasSound(file, ffprobePath);
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
    audio,
  };
}

interface ClipJson {
  streams?: { codec_type?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  format?: { duration?: string };
}

/**
 * What a video file is, for use as a clip: its size as it is shown (a phone
 * recording stored on its side is reported upright), its length and whether
 * it has sound. Null when the file is not a video ffmpeg can read.
 */
export async function probeClip(
  file: string,
  ffprobePath = "ffprobe",
): Promise<{ file: string; width: number; height: number; seconds: number; audio: boolean } | null> {
  let json: ClipJson;
  try {
    json = JSON.parse(
      await run(ffprobePath, [
        "-v", "error", "-protocol_whitelist", "file", "-select_streams", "v:0",
        "-show_entries", "stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration",
        "-of", "json", file,
      ]),
    ) as ClipJson;
  } catch (cause) {
    if (cause instanceof EnvironmentError) throw cause;
    return null;
  }
  const stream = json.streams?.[0];
  const seconds = Number(stream?.duration ?? json.format?.duration);
  if (!stream?.width || !stream.height || !(seconds > 0)) return null;
  const turn = Math.abs(Number(stream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0));
  const sideways = turn === 90 || turn === 270;
  return {
    file,
    width: sideways ? stream.height : stream.width,
    height: sideways ? stream.width : stream.height,
    seconds,
    audio: await hasSound(file, ffprobePath),
  };
}
