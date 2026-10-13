import type { Speech } from "./voice";
import { lookup as dnsLookup } from "node:dns/promises";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { isAbsolute, parse as parsePath, relative, resolve as resolvePath, sep } from "node:path";
import { type Diagnostic, type Scenefile, error } from "@scenefile/schema";
import { type SceneAsset, getScene } from "@scenefile/scenes";

/** Largest single image, in bytes. */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
/** Largest total of all images in one scenefile, in bytes. */
export const MAX_TOTAL_ASSET_BYTES = 32 * 1024 * 1024;
/** Largest image by dimension. Beyond this, decoding costs gigabytes of memory. */
export const MAX_IMAGE_SIDE = 16_384;
export const MAX_IMAGE_PIXELS = 40_000_000;

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
/** All downloads for one command share this much time. */
const TOTAL_DOWNLOAD_MS = 60_000;

type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface LoadedAsset extends SceneAsset {
  mime: ImageMime;
  bytes: number;
}

export type AssetMap = ReadonlyMap<string, LoadedAsset>;

/** One use of an image: the scenefile path of the field naming it, and what that field says. */
export interface AssetRef {
  path: string;
  src: string;
}

export interface LoadedAssets {
  assets: Map<string, LoadedAsset>;
  diagnostics: Diagnostic[];
  /** The scenefile's music, once found; null or absent when there is none. */
  audio?: LoadedAudio | null;
  /** Narration already made, by scene index. Scenes without an entry are timed by estimate. */
  speech?: Map<number, Speech>;
  /** Video clips that were found and read, by the `src` the scenefile gave. */
  clips?: Map<string, ClipInfo>;
  /** What was heard in clips that are to be captioned, by scene index. Times are seconds from where the clip starts playing. */
  transcripts?: Map<number, Heard[]>;
}

/** Something said: when it starts and ends, and the words. */
export interface Heard {
  start: number;
  end: number;
  text: string;
}

/** Listens to part of a file and returns what was said in it, timed from the start of that part. */
export type Transcribe = (file: string, fromSeconds: number, seconds: number) => Promise<Heard[]>;

/** What is known about a video file used as a clip. */
export interface ClipInfo {
  /** The file's real location, already confined to the scenefile's folder. */
  file: string;
  width: number;
  height: number;
  seconds: number;
  /** Whether it has a sound track. */
  audio: boolean;
  /** Whether it is HDR footage, which is drawn as it is rather than converted. */
  hdr?: boolean;
}

/** The largest picture a clip may have, on a side: footage beyond this takes gigabytes to decode. */
export const MAX_CLIP_SIDE = 8192;

/** The largest video file used as a clip. */
export const MAX_CLIP_BYTES = 4 * 1024 * 1024 * 1024;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** The part of an HTTP response that downloading needs. `close` abandons the body. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}

/** Where images come from. The network functions and the clock can be replaced in tests. */
export interface AssetSources {
  /** The scenefile's folder. Local images must be inside it. */
  baseDir: string;
  /** Whether images may be downloaded from https addresses. Defaults to true. */
  allowRemote?: boolean;
  /** Resolves a host name to its addresses. */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Makes one https GET to `url`, connecting to exactly `address`. Must not follow redirects. */
  request?: (url: URL, address: ResolvedAddress, timeoutMs: number) => Promise<HttpResponse>;
  now?: () => number;
}

/** Every image a scenefile uses, in scene order. */
export function assetRefs(scenefile: Scenefile): AssetRef[] {
  return scenefile.scenes.flatMap((scene, index) =>
    (getScene(scene.type).assets?.(scene) ?? []).map((ref) => ({
      path: `scenes[${index}].${ref.path}`,
      src: ref.src,
    })),
  );
}

/** Every video file a scenefile plays, with the path of the field that names it. */
export function clipRefs(scenefile: Scenefile): AssetRef[] {
  return scenefile.scenes.flatMap((scene, index) =>
    (getScene(scene.type).clips?.(scene) ?? []).map((ref) => ({ path: `scenes[${index}].${ref.path}`, src: ref.src })),
  );
}

/** EXIF orientation values that turn the image a quarter turn, swapping its width and height. */
function isSideways(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** The Orientation tag from a JPEG's EXIF segment, or 1 (upright) if there is none or it cannot be read. */
function exifOrientation(data: Buffer, segment: number): number {
  try {
    if (data.toString("latin1", segment + 4, segment + 10) !== "Exif\0\0") return 1;
    const tiff = segment + 10;
    const little = data.toString("latin1", tiff, tiff + 2) === "II";
    const u16 = (at: number): number => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
    const u32 = (at: number): number => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
    const directory = tiff + u32(tiff + 4);
    const entries = u16(directory);
    for (let i = 0; i < entries; i++) {
      const entry = directory + 2 + i * 12;
      if (u16(entry) === 0x0112) return u16(entry + 8);
    }
  } catch {
    // A truncated or malformed EXIF block: treat the image as upright.
  }
  return 1;
}

function isAnimatedPng(data: Buffer): boolean {
  // An animated PNG announces itself with an acTL chunk before the image data.
  let position = 8;
  while (position + 12 <= data.length) {
    const type = data.toString("latin1", position + 4, position + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    position += 12 + data.readUInt32BE(position);
  }
  return false;
}

/**
 * Reads an image's type and size from its bytes. The size is the one the
 * browser draws: a photo stored on its side with an EXIF rotation is reported
 * upright. Returns null for anything that is not a sound, still PNG, JPEG or
 * WebP: animated images would move on the browser's clock rather than the
 * frame's, and a damaged header would fail later, in the browser.
 */
export function imageInfo(data: Buffer): { mime: ImageMime; width: number; height: number } | null {
  const sized = (mime: ImageMime, width: number, height: number) =>
    width > 0 && height > 0 ? { mime, width, height } : null;

  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) {
    if (data.toString("latin1", 12, 16) !== "IHDR" || isAnimatedPng(data)) return null;
    return sized("image/png", data.readUInt32BE(16), data.readUInt32BE(20));
  }

  if (data.length >= 4 && data.readUInt16BE(0) === 0xffd8) {
    // Walk the segments to the frame header, which holds the size.
    let position = 2;
    let orientation = 1;
    while (position + 9 <= data.length) {
      if (data.readUInt8(position) !== 0xff) return null;
      const marker = data.readUInt8(position + 1);
      if (marker === 0xff) {
        position += 1;
        continue;
      }
      const standalone = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
      if (standalone) {
        position += 2;
        continue;
      }
      if (marker === 0xe1) orientation = exifOrientation(data, position);
      const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) {
        const height = data.readUInt16BE(position + 5);
        const width = data.readUInt16BE(position + 7);
        return isSideways(orientation) ? sized("image/jpeg", height, width) : sized("image/jpeg", width, height);
      }
      position += 2 + data.readUInt16BE(position + 2);
    }
    return null;
  }

  const isWebp =
    data.length >= 30 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP";
  if (isWebp) {
    const chunk = data.toString("latin1", 12, 16);
    if (chunk === "VP8X") {
      const animated = (data.readUInt8(20) & 0x02) !== 0;
      if (animated) return null;
      return sized("image/webp", data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
    }
    if (chunk === "VP8 ") return sized("image/webp", data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
    if (chunk === "VP8L") {
      const bits = data.readUInt32LE(21);
      return sized("image/webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
  }
  return null;
}

interface Failure {
  code: "ASSET_NOT_FOUND" | "ASSET_UNSUPPORTED" | "ASSET_TOO_LARGE";
  message: string;
  fix: string;
}

const USE_LOCAL = "Save the image in the scenefile's folder and give its file name.";

function notFound(message: string, fix: string = USE_LOCAL): Failure {
  return { code: "ASSET_NOT_FOUND", message, fix };
}

function tooLarge(src: string, maxBytes: number = MAX_ASSET_BYTES): Failure {
  return {
    code: "ASSET_TOO_LARGE",
    message: `"${src}" is larger than ${maxBytes / 1024 / 1024} MB.`,
    fix: "Use a smaller file; for an image, 1920 pixels wide is enough for a full frame.",
  };
}

/** The most specific reason an error carries. Network errors keep it one level down, in `cause`. */
function reason(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = cause.cause;
  return inner instanceof Error && inner.message ? inner.message : cause.message;
}

/**
 * Addresses a scenefile must not make the tool connect to: this machine,
 * private and link-local networks (which include cloud metadata services),
 * carrier-grade NAT, multicast, and ranges reserved for documentation and tests.
 */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 127], ["64:ff9b::", 96], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

/** True for an IP address that is not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return PRIVATE.check(address, "ipv4");
  if (family !== 6) return true;
  // An IPv4 address written as IPv6 is judged as the IPv4 address it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return PRIVATE.check(mapped[1], "ipv4");
  return PRIVATE.check(address, "ipv6");
}

/** Names that mean this machine or a local network whatever they resolve to. */
function isLocalName(host: string): boolean {
  return !host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i.test(host);
}

const PRIVATE_FAILURE = (host: string): Failure =>
  notFound(`"${host}" is this machine or a private network; images are not loaded from there.`);

async function systemLookup(hostname: string): Promise<ResolvedAddress[]> {
  const found = await dnsLookup(hostname, { all: true });
  return found.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
}

/** One https GET over Node's own client, which neither follows redirects nor decompresses. */
function requestOverHttps(url: URL, address: ResolvedAddress, timeoutMs: number): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        timeout: timeoutMs,
        headers: { accept: "image/png,image/jpeg,image/webp", "accept-encoding": "identity", "user-agent": "scenefile" },
        // Connect to the address that was checked, whatever the name resolves to
        // by now. The certificate is still verified against the name.
        lookup: (_hostname, options, callback) => {
          const done = callback as (error: Error | null, address: unknown, family?: number) => void;
          if (options.all) done(null, [address]);
          else done(null, address.address, address.family);
        },
      },
      (response) => {
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name] = Array.isArray(value) ? value[0] : value;
        }
        resolve({ status: response.statusCode ?? 0, headers, body: response, close: () => response.destroy() });
      },
    );
    request.on("timeout", () => request.destroy(new Error("the server did not answer in time")));
    request.on("error", reject);
    request.end();
  });
}

/**
 * Downloads one image. Every address on the way, the first and each redirect,
 * must be https and public: the name is resolved here, every address it
 * resolves to is checked, and the connection is made to a checked address.
 * The body is counted as it arrives and abandoned once it passes the limit.
 */
async function download(src: string, sources: AssetSources, deadline: number): Promise<Buffer | Failure> {
  const now = sources.now ?? Date.now;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return notFound(`"${src}" is not a valid address.`);
  }

  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:") {
      return notFound(`Images can be local files or https addresses; "${url.protocol}" addresses are not loaded.`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const literal = isIP(host);
    if (literal === 0 && isLocalName(host)) return PRIVATE_FAILURE(host);
    if (literal !== 0 && isPrivateAddress(host)) return PRIVATE_FAILURE(host);

    let addresses: ResolvedAddress[];
    try {
      addresses = literal !== 0 ? [{ address: host, family: literal === 6 ? 6 : 4 }] : await (sources.lookup ?? systemLookup)(host);
    } catch (cause) {
      return notFound(`"${host}" could not be found: ${reason(cause)}`, "Check the address.");
    }
    // If any address is private the name is refused, so it cannot be used to
    // reach a private machine on a later, different, lookup.
    const target = addresses[0];
    if (!target || addresses.some((entry) => isPrivateAddress(entry.address))) return PRIVATE_FAILURE(host);

    const remaining = deadline - now();
    if (remaining <= 0) return notFound(`"${src}" was not downloaded: loading images took too long.`);

    let response: HttpResponse;
    try {
      response = await (sources.request ?? requestOverHttps)(url, target, Math.min(REQUEST_TIMEOUT_MS, remaining));
    } catch (cause) {
      return notFound(`"${src}" could not be downloaded: ${reason(cause)}`);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      response.close();
      const location = response.headers.location;
      if (!location || hop >= MAX_REDIRECTS) return notFound(`"${src}" redirects too many times, or nowhere.`);
      try {
        url = new URL(location, url);
      } catch {
        return notFound(`"${src}" redirects to an address that is not valid.`);
      }
      continue;
    }
    if (response.status < 200 || response.status > 299) {
      response.close();
      return notFound(
        `The server answered ${response.status} for "${src}".`,
        "Check the address, or save the image in the scenefile's folder.",
      );
    }
    const encoding = response.headers["content-encoding"];
    if (encoding && encoding !== "identity") {
      // A compressed body can expand without limit; uncompressed was asked for.
      response.close();
      return notFound(`The server for "${src}" sent compressed data, which is not accepted.`);
    }
    if (Number(response.headers["content-length"] ?? 0) > MAX_ASSET_BYTES) {
      response.close();
      return tooLarge(src);
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_ASSET_BYTES) {
          response.close();
          return tooLarge(src);
        }
        if (now() > deadline) {
          response.close();
          return notFound(`"${src}" was not downloaded: loading images took too long.`);
        }
        chunks.push(chunk);
      }
    } catch (cause) {
      return notFound(`"${src}" could not be downloaded: ${reason(cause)}`);
    }
    return Buffer.concat(chunks);
  }
}

/** True when `file` is strictly inside `folder`. Both must be absolute. */
export function isInside(folder: string, file: string): boolean {
  const fromFolder = relative(folder, file);
  return fromFolder !== "" && fromFolder !== ".." && !fromFolder.startsWith(`..${sep}`) && !isAbsolute(fromFolder);
}

/**
 * Finds a local file a scenefile names, refusing anything outside the
 * scenefile's folder (links are followed before deciding), anything that is
 * not a plain file, and anything over `maxBytes`. Returns its real path.
 */
async function locateLocal(src: string, sources: AssetSources, maxBytes: number): Promise<string | Failure> {
  const outside = notFound(
    `"${src}" is outside the scenefile's folder, so it was not read.`,
    "Copy the file into the scenefile's folder and refer to it by a relative path.",
  );
  const missing = notFound(
    `There is no file "${src}" in the scenefile's folder.`,
    "Check the file name; paths are relative to the scenefile.",
  );
  const folder = resolvePath(sources.baseDir);
  // In the root folder "inside the scenefile's folder" would mean the whole disk.
  if (folder === parsePath(folder).root) {
    return notFound(
      "The scenefile is in the root folder, so local files are not read.",
      "Move the scenefile and its files into a folder of their own.",
    );
  }
  if (src.includes("\0")) return missing;
  const file = resolvePath(folder, src);
  if (!isInside(folder, file)) return outside;

  try {
    // Follow links before deciding: a link inside the folder may point outside it.
    const [realFolder, realFile] = await Promise.all([realpath(folder), realpath(file)]);
    if (!isInside(realFolder, realFile)) return outside;
    const info = await stat(realFile);
    if (!info.isFile()) return notFound(`"${src}" is a folder or a device, not a file.`, "Give the path of a file.");
    if (info.size > maxBytes) return tooLarge(src, maxBytes);
    return realFile;
  } catch {
    return missing;
  }
}

async function readLocal(src: string, sources: AssetSources): Promise<Buffer | Failure> {
  const located = await locateLocal(src, sources, MAX_ASSET_BYTES);
  if (typeof located !== "string") return located;
  try {
    return await readFile(located);
  } catch {
    return notFound(`"${src}" could not be read.`, "Check the file's permissions.");
  }
}

/** A string is an address if it names a scheme the way addresses do; otherwise it is a file name, colons and all. */
function isAddress(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(src) || /^(https?|file|data|blob|javascript|ftp):/i.test(src);
}

async function loadOne(src: string, sources: AssetSources, deadline: number): Promise<{ data: Buffer; info: NonNullable<ReturnType<typeof imageInfo>> } | Failure> {
  if (isAddress(src) && sources.allowRemote === false) {
    return notFound(`Downloading images is turned off here, so "${src}" was not loaded.`);
  }
  const data = await (isAddress(src) ? download(src, sources, deadline) : readLocal(src, sources));
  if (!Buffer.isBuffer(data)) return data;
  if (data.length > MAX_ASSET_BYTES) return tooLarge(src);
  const info = imageInfo(data);
  if (!info) {
    return {
      code: "ASSET_UNSUPPORTED",
      message: `"${src}" is not a PNG, JPEG or still WebP image, or the file is damaged.`,
      fix: "Convert it to PNG or JPEG. Animated images and SVG are not supported.",
    };
  }
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE || info.width * info.height > MAX_IMAGE_PIXELS) {
    return {
      code: "ASSET_TOO_LARGE",
      message: `"${src}" is ${info.width}x${info.height} pixels, more than can be drawn safely.`,
      fix: "Resize the image; 1920 pixels wide is enough for a full frame.",
    };
  }
  return { data, info };
}

/** Loads every image once, and reports each failure at every field that uses that image. */
export async function loadAssets(refs: readonly AssetRef[], sources: AssetSources): Promise<LoadedAssets> {
  const assets = new Map<string, LoadedAsset>();
  const failures = new Map<string, Failure>();
  const diagnostics: Diagnostic[] = [];
  const deadline = (sources.now ?? Date.now)() + TOTAL_DOWNLOAD_MS;
  let total = 0;
  for (const ref of refs) {
    if (!assets.has(ref.src) && !failures.has(ref.src)) {
      const outcome = await loadOne(ref.src, sources, deadline);
      if ("code" in outcome) {
        failures.set(ref.src, outcome);
      } else if (total + outcome.data.length > MAX_TOTAL_ASSET_BYTES) {
        failures.set(ref.src, {
          code: "ASSET_TOO_LARGE",
          message: `The images in this scenefile are together larger than ${MAX_TOTAL_ASSET_BYTES / 1024 / 1024} MB; "${ref.src}" was not loaded.`,
          fix: "Use fewer or smaller images.",
        });
      } else {
        total += outcome.data.length;
        assets.set(ref.src, {
          ...outcome.info,
          id: `a${assets.size}`,
          bytes: outcome.data.length,
          dataUri: `data:${outcome.info.mime};base64,${outcome.data.toString("base64")}`,
        });
      }
    }
    const failure = failures.get(ref.src);
    if (failure) diagnostics.push(error(failure.code, ref.path, failure.message, failure.fix));
  }
  return { assets, diagnostics };
}

/** Largest music file, in bytes. */
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

export interface LoadedAudio {
  /** The music file's real path. */
  file: string;
  volume: number;
}

/** True when a file's first bytes are those of MP3, AAC, WAV, M4A, Ogg or FLAC. */
function looksLikeAudio(head: Buffer): boolean {
  if (head.length < 12) return false;
  const text = (from: number, to: number): string => head.toString("latin1", from, to);
  return (
    text(0, 3) === "ID3" ||
    (head.readUInt8(0) === 0xff && (head.readUInt8(1) & 0xe0) === 0xe0) ||
    (text(0, 4) === "RIFF" && text(8, 12) === "WAVE") ||
    text(4, 8) === "ftyp" ||
    text(0, 4) === "OggS" ||
    text(0, 4) === "fLaC"
  );
}

/**
 * Finds the scenefile's music, if it names any. Music is a local file only:
 * it is handed to ffmpeg by path, and a scenefile must not be able to point
 * ffmpeg at anything outside its own folder.
 */
export async function loadAudio(
  scenefile: Scenefile,
  sources: AssetSources,
): Promise<{ audio: LoadedAudio | null; diagnostics: Diagnostic[] }> {
  const wanted = scenefile.audio;
  if (!wanted) return { audio: null, diagnostics: [] };
  const fail = (failure: Failure) => ({
    audio: null,
    diagnostics: [error(failure.code, "audio.src", failure.message, failure.fix)],
  });

  if (isAddress(wanted.src)) {
    return fail(
      notFound(
        "Music must be a local file in the scenefile's folder; addresses are not downloaded.",
        "Save the music beside the scenefile and give its file name.",
      ),
    );
  }
  const located = await locateLocal(wanted.src, sources, MAX_AUDIO_BYTES);
  if (typeof located !== "string") return fail(located);

  const head = Buffer.alloc(12);
  try {
    const handle = await open(located, "r");
    try {
      await handle.read(head, 0, 12, 0);
    } finally {
      await handle.close();
    }
  } catch {
    return fail(notFound(`"${wanted.src}" could not be read.`, "Check the file's permissions."));
  }
  if (!looksLikeAudio(head)) {
    return fail({
      code: "ASSET_UNSUPPORTED",
      message: `"${wanted.src}" is not an MP3, WAV, M4A, AAC, Ogg or FLAC file.`,
      fix: "Convert the music to MP3 or WAV.",
    });
  }
  return { audio: { file: located, volume: wanted.volume }, diagnostics: [] };
}

/**
 * Finds each clip in the scenefile's folder and asks what it is. Clips are
 * local files only, confined like images and music; reading the video itself
 * needs ffprobe, so that is passed in.
 */
export async function loadClips(
  refs: readonly AssetRef[],
  sources: AssetSources & { probeClip?: (file: string) => Promise<ClipInfo | null> },
): Promise<{ clips: Map<string, ClipInfo>; diagnostics: Diagnostic[] }> {
  const clips = new Map<string, ClipInfo>();
  const diagnostics: Diagnostic[] = [];
  const failed = new Map<string, Failure>();
  for (const ref of refs) {
    if (!sources.probeClip) break;
    if (!clips.has(ref.src) && !failed.has(ref.src)) {
      let failure: Failure | null = null;
      if (isAddress(ref.src)) {
        failure = notFound("A clip must be a video file in the scenefile's folder; addresses are not downloaded.", "Save the video beside the scenefile and give its file name.");
      } else {
        const located = await locateLocal(ref.src, sources, MAX_CLIP_BYTES);
        if (typeof located !== "string") failure = located;
        else {
          const info = await sources.probeClip(located);
          if (info && Math.max(info.width, info.height) > MAX_CLIP_SIDE) {
            failure = {
              code: "ASSET_TOO_LARGE",
              message: `"${ref.src}" is ${info.width}x${info.height}; a clip may be at most ${MAX_CLIP_SIDE} pixels on a side.`,
              fix: "Make a smaller copy of the video and use that.",
            };
          } else if (info) clips.set(ref.src, info);
          else {
            failure = {
              code: "ASSET_UNSUPPORTED",
              message: `"${ref.src}" is not a video that can be read: it is damaged, or it is not a video file.`,
              fix: "Use an MP4, MOV or WebM file, or convert this one with ffmpeg.",
            };
          }
        }
      }
      if (failure) failed.set(ref.src, failure);
    }
    const failure = failed.get(ref.src);
    if (failure) diagnostics.push(error(failure.code, ref.path, failure.message, failure.fix));
  }
  return { clips, diagnostics };
}
