import { readFile as readFileFromDisk } from "node:fs/promises";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { type Diagnostic, type Scenefile, error } from "@scenefile/schema";
import { type SceneAsset, getScene } from "@scenefile/scenes";

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface LoadedAsset extends SceneAsset {
  mime: ImageMime;
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
}

/** Where images come from. `fetch` and `readFile` can be replaced in tests. */
export interface AssetSources {
  /** The scenefile's folder. Local images must be inside it. */
  baseDir: string;
  fetch?: typeof fetch;
  readFile?: (path: string) => Promise<Buffer>;
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

/**
 * Reads an image's type and size from its first bytes. Returns null for
 * anything that is not a still PNG, JPEG or WebP: animated images would move
 * on the browser's clock rather than the frame's.
 */
export function imageInfo(data: Buffer): { mime: ImageMime; width: number; height: number } | null {
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) {
    return { mime: "image/png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }

  if (data.length >= 4 && data.readUInt16BE(0) === 0xffd8) {
    // Walk the segments to the frame header, which holds the size.
    let position = 2;
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
      const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) {
        return { mime: "image/jpeg", height: data.readUInt16BE(position + 5), width: data.readUInt16BE(position + 7) };
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
      return { mime: "image/webp", width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
    }
    if (chunk === "VP8 ") {
      return { mime: "image/webp", width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L") {
      const bits = data.readUInt32LE(21);
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
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

/** Hosts that name this machine or a private network. A scenefile must not make the tool call into them. */
const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[.*\])$/i;

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function download(src: string, sources: AssetSources): Promise<Buffer | Failure> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return { code: "ASSET_NOT_FOUND", message: `"${src}" is not a valid address.`, fix: USE_LOCAL };
  }
  if (url.protocol !== "https:") {
    return {
      code: "ASSET_NOT_FOUND",
      message: `Images can be local files or https addresses; "${url.protocol}" addresses are not loaded.`,
      fix: USE_LOCAL,
    };
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    return {
      code: "ASSET_NOT_FOUND",
      message: `"${url.hostname}" is this machine or a private network; images are not loaded from there.`,
      fix: USE_LOCAL,
    };
  }
  try {
    const response = await (sources.fetch ?? fetch)(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      return {
        code: "ASSET_NOT_FOUND",
        message: `The server answered ${response.status} for "${src}".`,
        fix: "Check the address, or save the image in the scenefile's folder.",
      };
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_ASSET_BYTES) return tooLarge(src);
    return Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    return { code: "ASSET_NOT_FOUND", message: `"${src}" could not be downloaded: ${reason(cause)}`, fix: USE_LOCAL };
  }
}

async function readLocal(src: string, sources: AssetSources): Promise<Buffer | Failure> {
  const file = resolvePath(sources.baseDir, src);
  const fromBase = relative(sources.baseDir, file);
  if (fromBase.startsWith("..") || isAbsolute(fromBase)) {
    return {
      code: "ASSET_NOT_FOUND",
      message: `"${src}" is outside the scenefile's folder, so it was not read.`,
      fix: "Copy the image into the scenefile's folder and refer to it by a relative path.",
    };
  }
  try {
    return await (sources.readFile ?? readFileFromDisk)(file);
  } catch {
    return {
      code: "ASSET_NOT_FOUND",
      message: `There is no file "${src}" in the scenefile's folder.`,
      fix: "Check the file name; paths are relative to the scenefile.",
    };
  }
}

function tooLarge(src: string): Failure {
  return {
    code: "ASSET_TOO_LARGE",
    message: `"${src}" is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB.`,
    fix: "Resize or compress the image; 1920 pixels wide is enough for a full frame.",
  };
}

async function loadOne(src: string, sources: AssetSources): Promise<LoadedAsset | Failure> {
  // Anything with a scheme is an address; a Windows drive letter is not a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src);
  const data = await (hasScheme ? download(src, sources) : readLocal(src, sources));
  if (!Buffer.isBuffer(data)) return data;
  if (data.length > MAX_ASSET_BYTES) return tooLarge(src);
  const info = imageInfo(data);
  if (!info) {
    return {
      code: "ASSET_UNSUPPORTED",
      message: `"${src}" is not a PNG, JPEG or still WebP image.`,
      fix: "Convert it to PNG or JPEG. Animated images and SVG are not supported.",
    };
  }
  return { ...info, dataUri: `data:${info.mime};base64,${data.toString("base64")}` };
}

/** Loads every image once, and reports each failure at every field that uses that image. */
export async function loadAssets(refs: readonly AssetRef[], sources: AssetSources): Promise<LoadedAssets> {
  const assets = new Map<string, LoadedAsset>();
  const failures = new Map<string, Failure>();
  const diagnostics: Diagnostic[] = [];
  for (const ref of refs) {
    if (!assets.has(ref.src) && !failures.has(ref.src)) {
      const outcome = await loadOne(ref.src, sources);
      if ("dataUri" in outcome) assets.set(ref.src, outcome);
      else failures.set(ref.src, outcome);
    }
    const failure = failures.get(ref.src);
    if (failure) diagnostics.push(error(failure.code, ref.path, failure.message, failure.fix));
  }
  return { assets, diagnostics };
}
