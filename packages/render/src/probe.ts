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
export async function hasSound(file: string, ffprobePath = "ffprobe", formats?: string): Promise<boolean> {
  try {
    const found = await run(ffprobePath, [
      "-v", "error", "-protocol_whitelist", "file", ...(formats ? ["-format_whitelist", formats] : []), "-select_streams", "a:0",
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

/** The kinds of file a clip may be. Anything else, such as a playlist that names other files, is not opened. */
export const CLIP_FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm";

interface ClipJson {
  streams?: {
    width?: number;
    height?: number;
    duration?: string;
    sample_aspect_ratio?: string;
    color_transfer?: string;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
  }[];
}

/** When a file does not say how long its picture lasts, the time its last video frame ends. */
async function lastFrameEnd(file: string, ffprobePath: string): Promise<number> {
  const packets = await run(ffprobePath, [
    "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", CLIP_FORMATS, "-select_streams", "v:0",
    "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", file,
  ]);
  let end = 0;
  for (const line of packets.split("\n")) {
    const [at, lasts] = line.split(",").map(Number);
    if (Number.isFinite(at)) end = Math.max(end, (at ?? 0) + (Number.isFinite(lasts) ? (lasts ?? 0) : 0));
  }
  return end;
}

/**
 * What a video file is, for use as a clip: its size as it is shown (a phone
 * recording stored on its side is reported upright, and pixels that are not
 * square are allowed for), how long its picture lasts, whether it has sound
 * and whether it is HDR. Null when the file is not a video that may be read.
 */
export async function probeClip(
  file: string,
  ffprobePath = "ffprobe",
): Promise<{ file: string; width: number; height: number; seconds: number; audio: boolean; hdr: boolean } | null> {
  let json: ClipJson;
  try {
    json = JSON.parse(
      await run(ffprobePath, [
        "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", CLIP_FORMATS, "-select_streams", "v:0",
        "-show_entries", "stream=width,height,duration,sample_aspect_ratio,color_transfer:stream_tags=rotate:stream_side_data=rotation",
        "-of", "json", file,
      ]),
    ) as ClipJson;
  } catch (cause) {
    if (cause instanceof EnvironmentError) throw cause;
    return null;
  }
  const stream = json.streams?.[0];
  if (!stream?.width || !stream.height) return null;
  // The picture's own length: the file as a whole may run on with sound alone, or not say at all.
  let seconds = Number(stream.duration);
  if (!(seconds > 0)) seconds = await lastFrameEnd(file, ffprobePath).catch(() => 0);
  if (!(seconds > 0)) return null;
  const [wide = 1, tall = 1] = (stream.sample_aspect_ratio ?? "1:1").split(":").map(Number);
  const shown = wide > 0 && tall > 0 ? Math.round((stream.width * wide) / tall) : stream.width;
  const turn = Math.abs(Number(stream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0));
  const sideways = turn === 90 || turn === 270;
  return {
    file,
    width: sideways ? stream.height : shown,
    height: sideways ? shown : stream.height,
    seconds,
    audio: await hasSound(file, ffprobePath),
    hdr: stream.color_transfer === "smpte2084" || stream.color_transfer === "arib-std-b67",
  };
}

/** Where a file's sound track starts and how long it lasts, in seconds. NaN where it does not say. */
export async function probeSound(file: string, ffprobePath = "ffprobe"): Promise<{ start: number; seconds: number }> {
  const found = await run(ffprobePath, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=start_time,duration", "-of", "csv=p=0", file]);
  const [start = "NaN", seconds = "NaN"] = found.trim().split(",");
  return { start: Number(start), seconds: Number(seconds) };
}
