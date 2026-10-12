import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Speak, Speech } from "@scenefile/engine";
import { VOICES, type VoiceName } from "@scenefile/schema";

/**
 * Narration is made on this machine by an open speech model: no account, no
 * key, nothing sent anywhere. Each voice is one download (about 67 MB), from
 * a fixed address and checked against a known checksum before use.
 */
export interface VoiceInfo {
  language: string;
  describes: string;
  /** The licence of the recordings the voice was trained on. */
  licence: string;
  /** Name of the model inside the archive. */
  model: string;
  sha256: string;
  bytes: number;
}

export const VOICE_CATALOG: Readonly<Record<VoiceName, VoiceInfo>> = {
  "en-joe": { language: "English", describes: "man, American", licence: "CC0", model: "en_US-joe-medium", sha256: "261b903a1fb2ce621e2b5b14233cd41223c3b9f9590f896c11daee4df22d9bd3", bytes: 67169394 },
  "en-kristin": { language: "English", describes: "woman, American", licence: "public domain", model: "en_US-kristin-medium", sha256: "c2206f572df2956c50b1ae3367eebce3853c663e890cba8048cd62b1e4dbe6c7", bytes: 67259230 },
  "en-bryce": { language: "English", describes: "man, American, slower", licence: "public domain", model: "en_US-bryce-medium", sha256: "f35bb77ddecdf229798e850d1c77ded839d4179879be8b90da5f82e7beb538f2", bytes: 67278133 },
  "ru-denis": { language: "Russian", describes: "man", licence: "CC0", model: "ru_RU-denis-medium", sha256: "efa4c18e0b5e32b81d1b6df36b9d312831e5d545200e27848ef926a4cd930300", bytes: 67190991 },
  "ru-dmitri": { language: "Russian", describes: "man, quicker", licence: "CC0", model: "ru_RU-dmitri-medium", sha256: "c86d0803737de13d441923ff3b3f309482fab8d7af3ec85949942809eb9a3660", bytes: 67188551 },
};

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

export function isVoice(name: string): name is VoiceName {
  return (VOICES as readonly string[]).includes(name);
}

/** Where voices and finished lines are kept between runs. */
export function voiceHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.SCENEFILE_HOME ?? join(homedir(), ".cache", "scenefile");
}

function folderOf(voicesDir: string, name: VoiceName): string {
  return join(voicesDir, `vits-piper-${VOICE_CATALOG[name].model}`);
}

export function voiceInstalled(voicesDir: string, name: VoiceName): boolean {
  return existsSync(join(folderOf(voicesDir, name), `${VOICE_CATALOG[name].model}.onnx`));
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
  });
}

export interface InstallOptions {
  voicesDir: string;
  /** Replaces the download. For tests. */
  fetch?: typeof fetch;
  /** Replaces unpacking the archive with `tar`. For tests. */
  unpack?: (archive: string, into: string) => Promise<void>;
}

/** Downloads a voice, checks it is the file expected, and unpacks it. Does nothing if it is already there. */
export async function installVoice(name: VoiceName, options: InstallOptions): Promise<void> {
  if (voiceInstalled(options.voicesDir, name)) return;
  const info = VOICE_CATALOG[name];
  await mkdir(options.voicesDir, { recursive: true });
  const archive = join(options.voicesDir, `.${name}.download-${process.pid}`);
  try {
    const response = await (options.fetch ?? fetch)(`${RELEASE}/vits-piper-${info.model}.tar.bz2`, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`The voice "${name}" could not be downloaded (${response.status}).`);
    const hash = createHash("sha256");
    const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => hash.update(chunk));
    await pipeline(body, createWriteStream(archive));
    if (hash.digest("hex") !== info.sha256) {
      throw new Error(`The download for the voice "${name}" is not the file that was expected, so it was not used.`);
    }
    await (options.unpack ?? ((file, into) => run("tar", ["-xjf", file, "-C", into])))(archive, options.voicesDir);
    if (!voiceInstalled(options.voicesDir, name)) throw new Error(`The voice "${name}" was downloaded but could not be unpacked.`);
  } finally {
    await rm(archive, { force: true });
  }
}

/** Sound as numbers between -1 and 1. */
export interface Samples {
  samples: Float32Array;
  sampleRate: number;
}
export type Synthesize = (voiceFolder: string, model: string, text: string) => Samples | Promise<Samples>;

interface SherpaTts {
  generate(request: { text: string; sid: number; speed: number }): Samples;
}
const engines = new Map<string, SherpaTts>();

/** The real speech engine. Loaded on first use: it is a large native library that silent videos never need. */
const sherpa: Synthesize = (voiceFolder, model, text) => {
  let engine = engines.get(voiceFolder);
  if (!engine) {
    let library: { OfflineTts: new (config: unknown) => SherpaTts };
    try {
      library = createRequire(import.meta.url)("sherpa-onnx-node");
    } catch {
      throw new Error("The speech engine is not installed for this kind of computer. Reinstall scenefile, or remove `say` from the scenes.");
    }
    engine = new library.OfflineTts({
      model: {
        vits: { model: join(voiceFolder, `${model}.onnx`), tokens: join(voiceFolder, "tokens.txt"), dataDir: join(voiceFolder, "espeak-ng-data") },
        numThreads: 2,
        provider: "cpu",
      },
      maxNumSentences: 1,
    });
    engines.set(voiceFolder, engine);
  }
  return engine.generate({ text, sid: 0, speed: 1 });
};

function wave({ samples, sampleRate }: Samples): Buffer {
  const file = Buffer.alloc(44 + samples.length * 2);
  file.write("RIFF", 0, "latin1");
  file.writeUInt32LE(36 + samples.length * 2, 4);
  file.write("WAVEfmt ", 8, "latin1");
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36, "latin1");
  file.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    file.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32767), 44 + i * 2);
  }
  return file;
}

export interface SpeakerOptions {
  /** Folder holding voices and finished lines. Defaults to `voiceHome()`. */
  home?: string;
  /** Whether a voice that is not installed may be downloaded. */
  download: boolean;
  /** Called before a download starts, so a person knows why they are waiting. */
  onDownload?: (name: VoiceName, info: VoiceInfo) => void;
  /** Replaces the speech engine. For tests. */
  synthesize?: Synthesize;
  install?: Omit<InstallOptions, "voicesDir">;
}

/**
 * Makes narration. A line already said in the same voice is read back from
 * disk: the engine does not produce the same samples twice, so keeping the
 * file is also what makes a video render the same way again.
 */
export function createSpeaker(options: SpeakerOptions): Speak {
  const home = options.home ?? voiceHome();
  const voicesDir = join(home, "voices");
  const linesDir = join(home, "lines");
  return async (text, voice): Promise<Speech> => {
    const info = VOICE_CATALOG[voice];
    const id = createHash("sha256").update(JSON.stringify([info.sha256, text])).digest("hex").slice(0, 32);
    const file = join(linesDir, `${id}.wav`);
    const noted = `${file}.json`;
    try {
      return { file, seconds: (JSON.parse(await readFile(noted, "utf8")) as { seconds: number }).seconds };
    } catch {
      // Not made yet.
    }
    if (!voiceInstalled(voicesDir, voice)) {
      if (!options.download) {
        throw new Error(`The voice "${voice}" is not installed. Install it once with: scenefile voices install ${voice}`);
      }
      options.onDownload?.(voice, info);
      await installVoice(voice, { voicesDir, ...options.install });
    }
    const sound = await (options.synthesize ?? sherpa)(folderOf(voicesDir, voice), info.model, text);
    if (sound.samples.length === 0) throw new Error("The voice produced no sound for this line. Check that it is written in the voice's language.");
    await mkdir(linesDir, { recursive: true });
    const partial = `${file}.${process.pid}.partial`;
    await writeFile(partial, wave(sound));
    await rename(partial, file);
    const seconds = sound.samples.length / sound.sampleRate;
    await writeFile(noted, JSON.stringify({ seconds, voice, text }));
    return { file, seconds };
  };
}
