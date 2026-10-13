import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Heard, Transcribe } from "@scenefile/engine";
import { runFfmpeg } from "./encode";
import { hasSound } from "./probe";
import { type InstallOptions, type VoiceInfo, hearInHelper, installVoice, voiceHome } from "./voice";

/**
 * Listening to what is said in a file is done on this machine by an open
 * speech-recognition model (Whisper "base", MIT licence), found for each
 * stretch of speech by a small voice-activity detector (Silero, MIT). Like the
 * voices, both are downloaded once, from fixed addresses, and checked.
 */
const ASR = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
export const HEARING_MODEL: VoiceInfo = {
  language: "many",
  describes: "speech recognition",
  basis: "Whisper base, MIT licence",
  model: "whisper-base",
  folder: "sherpa-onnx-whisper-base",
  url: `${ASR}/sherpa-onnx-whisper-base.tar.bz2`,
  files: ["base-encoder.int8.onnx", "base-decoder.int8.onnx", "base-tokens.txt"],
  sha256: "911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de",
  bytes: 207557382,
};
const DETECTOR = { file: "silero_vad.onnx", url: `${ASR}/silero_vad.onnx`, sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6" };

/** Kinds of file that may be listened to: the clip kinds, and plain sound files. */
const HEARABLE = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,wav,mp3,flac,ogg,aac";

function places(home: string): { dir: string; model: string; detector: string } {
  const dir = join(home, "hearing");
  return { dir, model: join(dir, HEARING_MODEL.folder ?? ""), detector: join(dir, DETECTOR.file) };
}

/** True when the listening model and its detector are both in place. */
export function hearingInstalled(home: string = voiceHome()): boolean {
  const at = places(home);
  return existsSync(at.detector) && (HEARING_MODEL.files ?? []).every((part) => existsSync(join(at.model, part)));
}

/** Downloads the listening model (about 200 MB) and its detector. Does nothing if they are there. */
export async function installHearing(home: string = voiceHome(), options: Omit<InstallOptions, "voicesDir" | "info"> = {}): Promise<void> {
  const at = places(home);
  await installVoice("the listening model", { ...options, voicesDir: at.dir, info: HEARING_MODEL });
  if (existsSync(at.detector)) return;
  const response = await (options.fetch ?? fetch)(DETECTOR.url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`The speech detector could not be downloaded (${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== DETECTOR.sha256) {
    throw new Error("The download for the speech detector is not the file that was expected, so it was not used.");
  }
  const partial = `${at.detector}.${process.pid}.partial`;
  await writeFile(partial, data);
  await rename(partial, at.detector);
}

export interface TranscriberOptions {
  /** Folder holding what has been heard before. Defaults to `voiceHome()`. */
  home?: string;
  /** Where the listening model is, when not inside `home`. */
  modelHome?: string;
  /** Whether the model may be downloaded if it is missing. */
  download: boolean;
  onDownload?: (megabytes: number) => void;
  install?: Omit<InstallOptions, "voicesDir" | "info">;
  /** The language spoken, as a two-letter code; leave out to let the model tell. */
  language?: string;
  /** Replaces the model. For tests. */
  recognize?: (samples: Float32Array) => Promise<Heard[]>;
  /** Says the model is in place. For tests that replace it. */
  installed?: boolean;
}

/**
 * Listens to a part of a file and returns what was said, each stretch timed
 * from the start of that part. What was heard is kept, keyed by the file as it
 * is now and the part asked for, so asking again costs nothing.
 */
export function createTranscriber(options: TranscriberOptions): Transcribe {
  const home = options.home ?? voiceHome();
  const modelHome = options.modelHome ?? home;
  const kept = join(home, "heard");
  return async (file, fromSeconds, seconds): Promise<Heard[]> => {
    if (!(await hasSound(file))) return [];
    const info = await stat(file);
    const id = createHash("sha256")
      .update(JSON.stringify(["heard-3", file, info.size, info.mtimeMs, fromSeconds, seconds, options.language ?? ""]))
      .digest("hex")
      .slice(0, 32);
    const note = join(kept, `${id}.json`);
    try {
      return JSON.parse(await readFile(note, "utf8")) as Heard[];
    } catch {
      // Not listened to yet.
    }
    if (!options.installed && !hearingInstalled(modelHome)) {
      if (!options.download) throw new Error("The listening model is not installed. Install it once with: scenefile transcribe --install");
      options.onDownload?.(Math.round(HEARING_MODEL.bytes / 1e6));
      await installHearing(modelHome, options.install);
    }
    // The part asked for, as the model wants it: one channel at 16 kHz.
    const sound = join(tmpdir(), `scenefile-hear-${process.pid}-${id}.f32`);
    try {
      await runFfmpeg([
        "-protocol_whitelist", "file", "-format_whitelist", HEARABLE,
        "-ss", fromSeconds.toFixed(3), "-t", seconds.toFixed(3), "-i", file,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", sound,
      ]);
      let heard: Heard[];
      if (options.recognize) {
        const raw = await readFile(sound);
        heard = await options.recognize(new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4)));
      } else {
        const at = places(modelHome);
        heard = await hearInHelper(sound, at.model, at.detector, options.language ?? "");
      }
      // The model sometimes returns a stretch with nothing in it; those are dropped.
      const said = heard
        .map((part) => ({ start: Math.max(0, part.start), end: Math.min(part.end, seconds), text: part.text.replace(/\s+/g, " ").trim() }))
        .filter((part) => part.text !== "" && part.end > part.start);
      await mkdir(kept, { recursive: true });
      await writeFile(note, JSON.stringify(said));
      return said;
    } finally {
      await rm(sound, { force: true });
    }
  };
}
