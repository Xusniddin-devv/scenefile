import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
  /** Where the voice comes from: what it was trained on, and under what terms. */
  basis: string;
  /** Name of the model inside the archive. */
  model: string;
  sha256: string;
  bytes: number;
}

export const VOICE_CATALOG: Readonly<Record<VoiceName, VoiceInfo>> = {
  "en-joe": { language: "English", describes: "man, American", basis: "its own recordings are CC0, but it was fine-tuned from a voice trained on recordings licensed for research only", model: "en_US-joe-medium", sha256: "261b903a1fb2ce621e2b5b14233cd41223c3b9f9590f896c11daee4df22d9bd3", bytes: 67169394 },
  "en-kristin": { language: "English", describes: "woman, American", basis: "trained only on public-domain recordings (LibriVox)", model: "en_US-kristin-medium", sha256: "c2206f572df2956c50b1ae3367eebce3853c663e890cba8048cd62b1e4dbe6c7", bytes: 67259230 },
  "en-bryce": { language: "English", describes: "man, American, slower", basis: "public-domain recordings, fine-tuned from a voice whose own basis is not published", model: "en_US-bryce-medium", sha256: "f35bb77ddecdf229798e850d1c77ded839d4179879be8b90da5f82e7beb538f2", bytes: 67278133 },
  "ru-denis": { language: "Russian", describes: "man", basis: "its own recordings are CC0, but it was fine-tuned from a voice trained on recordings licensed for research only", model: "ru_RU-denis-medium", sha256: "efa4c18e0b5e32b81d1b6df36b9d312831e5d545200e27848ef926a4cd930300", bytes: 67190991 },
  "ru-dmitri": { language: "Russian", describes: "man, quicker", basis: "its own recordings are CC0, but it was fine-tuned from a voice trained on recordings licensed for research only", model: "ru_RU-dmitri-medium", sha256: "c86d0803737de13d441923ff3b3f309482fab8d7af3ec85949942809eb9a3660", bytes: 67188551 },
};

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

export function isVoice(name: string): name is VoiceName {
  return (VOICES as readonly string[]).includes(name);
}

/** Where voices and finished lines are kept between runs. */
export function voiceHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.SCENEFILE_HOME || join(homedir(), ".cache", "scenefile");
}

function folderOf(voicesDir: string, name: VoiceName): string {
  return join(voicesDir, `vits-piper-${VOICE_CATALOG[name].model}`);
}

/** A voice needs all of these; one missing makes the speech engine fail or crash. */
function wholeVoice(folder: string, model: string): boolean {
  return [`${model}.onnx`, "tokens.txt", join("espeak-ng-data", "phontab")].every((part) => existsSync(join(folder, part)));
}

export function voiceInstalled(voicesDir: string, name: VoiceName): boolean {
  return wholeVoice(folderOf(voicesDir, name), VOICE_CATALOG[name].model);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let said = "";
    child.stderr.on("data", (chunk: Buffer) => {
      said = (said + chunk.toString("utf8")).slice(-400);
    });
    child.on("error", () => reject(new Error(`The "${command}" program is needed to unpack a voice and was not found.`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Unpacking the voice failed (${command} needs bzip2 support): ${said.trim()}`)),
    );
  });
}

export interface InstallOptions {
  voicesDir: string;
  /** Replaces the download. For tests. */
  fetch?: typeof fetch;
  /** Replaces unpacking the archive with `tar`. For tests. */
  unpack?: (archive: string, into: string) => Promise<void>;
  /** Replaces the catalog entry. For tests. */
  info?: VoiceInfo;
}

/** Longest a voice download may take. */
const DOWNLOAD_MS = 10 * 60 * 1000;

/** Downloads a voice, checks it is the file expected, and unpacks it. Does nothing if it is already there. */
export async function installVoice(name: VoiceName, options: InstallOptions): Promise<void> {
  const info = options.info ?? VOICE_CATALOG[name];
  const folder = `vits-piper-${info.model}`;
  const target = join(options.voicesDir, folder);
  if (wholeVoice(target, info.model)) return;
  await mkdir(options.voicesDir, { recursive: true });
  // Everything happens in a folder of its own and is moved into place only when
  // whole, so a download or unpack that is cut short never looks like a voice.
  const work = join(options.voicesDir, `.${name}.installing-${process.pid}`);
  const archive = join(work, "voice.tar.bz2");
  try {
    await rm(work, { recursive: true, force: true });
    await mkdir(work);
    const response = await (options.fetch ?? fetch)(`${RELEASE}/${folder}.tar.bz2`, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_MS),
    });
    if (!response.ok || !response.body) throw new Error(`The voice "${name}" could not be downloaded (${response.status}).`);
    const hash = createHash("sha256");
    let received = 0;
    const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      if (received > info.bytes) body.destroy(new Error(`The download for the voice "${name}" is larger than expected, so it was stopped.`));
    });
    await pipeline(body, createWriteStream(archive));
    if (hash.digest("hex") !== info.sha256) {
      throw new Error(`The download for the voice "${name}" is not the file that was expected, so it was not used.`);
    }
    await (options.unpack ?? ((file, into) => run("tar", ["-xjf", file, "-C", into])))(archive, work);
    if (!wholeVoice(join(work, folder), info.model)) throw new Error(`The voice "${name}" was downloaded but could not be unpacked.`);
    // A half-made folder from an earlier version, or another process that finished first.
    if (!wholeVoice(target, info.model)) {
      await rm(target, { recursive: true, force: true });
      await rename(join(work, folder), target);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
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
    try {
      engine = new library.OfflineTts({
      model: {
          vits: { model: join(voiceFolder, `${model}.onnx`), tokens: join(voiceFolder, "tokens.txt"), dataDir: join(voiceFolder, "espeak-ng-data") },
        numThreads: 2,
        provider: "cpu",
      },
        maxNumSentences: 1,
      });
    } catch {
      throw new Error("This voice's files are damaged. Delete its folder in the voices directory and install it again with: scenefile voices install <name>");
    }
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
  /** The most disk the saved lines may take; the oldest are deleted to stay under it. */
  maxCacheBytes?: number;
}

const MAX_CACHE_BYTES = 500 * 1024 * 1024;

/** Deletes the oldest saved lines until the rest fit under the limit. */
async function prune(linesDir: string, limit: number, keep: string): Promise<void> {
  const files = await Promise.all(
    (await readdir(linesDir))
      .filter((name) => name.endsWith(".wav"))
      .map(async (name) => ({ path: join(linesDir, name), ...(await stat(join(linesDir, name))) })),
  );
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= limit) break;
    if (file.path === keep) continue;
    await rm(file.path, { force: true });
    await rm(`${file.path}.json`, { force: true });
    total -= file.size;
  }
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
      const { seconds } = JSON.parse(await readFile(noted, "utf8")) as { seconds?: unknown };
      if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && existsSync(file)) return { file, seconds };
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
    await writeFile(noted, JSON.stringify({ seconds, voice }));
    await prune(linesDir, options.maxCacheBytes ?? MAX_CACHE_BYTES, file).catch(() => undefined);
    return { file, seconds };
  };
}
