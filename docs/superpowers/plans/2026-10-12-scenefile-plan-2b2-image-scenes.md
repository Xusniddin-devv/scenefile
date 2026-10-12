# scenefile Plan 2b-2 — Images, `screenshot` and `compare` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scenefile can show images: a `screenshot` scene with callouts and a `compare` scene for before and after, with images loaded, checked, and embedded so rendering stays offline and repeatable.

**Architecture:** Scenes declare the images they use. The engine loads them (local files inside the scenefile's folder, or https), reads their type and size from the bytes, and embeds them as data URIs. Scenes size images at compile time from the frame and image dimensions, so no layout guesswork happens in the browser. The runtime decodes every image before the first frame and reports the size each is shown at, which becomes a low-resolution warning and a storyboard line.

**Tech Stack:** As before. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-scenefile-v1-design.md`

## Where this plan sits

- **2b-2 (this plan):** asset loading, `screenshot`, `compare`.
- **2b-3:** `custom` (raw HTML and CSS). It needs a sanitizer and externally driven CSS animations, and deserves its own security review.
- **2c:** transitions, audio, parallel render, golden frames, more themes.

### Deviations from the spec, deliberate

- **No asset cache yet.** The spec describes a content-addressed cache. Images are fetched once per command; a cache arrives with the MCP server, where repeated calls make it matter.
- **PNG, JPEG and still WebP only.** GIF and animated WebP would animate on the browser's clock, not the frame's. SVG is deferred with `custom`.
- **`compare` takes text or an image per side**, not only images. Most before-and-after claims in a launch video are sentences.
- **Callouts are optional and capped at three.** A model that cannot see the image should not be asked for coordinates.

## Global Constraints

All earlier constraints apply. In addition:

- The composition references no file and no address: every image is a `data:` URI.
- Local images must be inside the scenefile's folder. Remote images must be `https` and not on a private or loopback host.
- An image is at most 8 MB.
- Every image is decoded before text is fitted or a frame is captured.
- Image sizes are whole pixels computed at compile time.
- Text that is deliberately not fitted (a callout label, a side label) is marked `data-sf-fixed` and is never smaller than 3.4 units, except labels in the scene counter's style (2.4 units).
- No `Co-Authored-By` trailer on commits.
- After any scene or CSS change, run the reproducibility tests.

## Review Focus

1. **An image path that escapes the scenefile's folder** (`../secret.png`, an absolute path, a symlink is out of scope). Expected: `ASSET_NOT_FOUND` saying it is outside the folder; the file is not read. Task 1.
2. **A file that is not an image, or is a GIF or animated WebP.** Expected: `ASSET_UNSUPPORTED`. Task 1.
3. **A remote address that is `http`, loopback, or private.** Expected: refused before any request. Task 1.
4. **A small image shown large.** Expected: `ASSET_LOW_RES` warning with the size needed. Task 2.
5. **Very tall or very wide images, in all three formats.** Expected: the image fits its area whole, never cropped or overflowing. Task 2.

## How edits are written in this plan

Whole files under their path, and edit blocks (`FILE` / `<<<<` / `====` / `>>>>`) whose old text occurs exactly once.

---

### Task 1: Loading images, and giving scenes the frame and the images

**Files:**
- Create: `packages/engine/src/assets.ts`, `packages/engine/test/assets.test.ts`, `packages/scenes/test/context.ts`
- Modify: `packages/scenes/src/types.ts`, `packages/scenes/src/index.ts`, `packages/engine/src/resolve.ts`, `packages/engine/src/compile.ts`, `packages/engine/src/check.ts`, `packages/engine/src/index.ts`, `packages/cli/src/run.ts`, and the tests in `packages/scenes/test` that build a compile context

**Interfaces:**
- Produces:
  - `CompileContext` gains `frame: { width: number; height: number; unit: number }` and `asset(src: string): SceneAsset | undefined`, where `interface SceneAsset { dataUri: string; width: number; height: number }`
  - `SceneDefinition.assets?(props): { path: string; src: string }[]` (path relative to the scene)
  - `interface LoadedAsset extends SceneAsset { mime: "image/png" | "image/jpeg" | "image/webp" }`, `type AssetMap = ReadonlyMap<string, LoadedAsset>`, `interface AssetRef { path: string; src: string }`
  - `MAX_ASSET_BYTES`, `assetRefs(scenefile): AssetRef[]`, `imageInfo(data: Buffer): { mime; width; height } | null`
  - `interface AssetSources { baseDir: string; fetch?: typeof fetch; readFile?: (path: string) => Promise<Buffer> }`
  - `loadAssets(refs: AssetRef[], sources: AssetSources): Promise<LoadedAssets>` where `interface LoadedAssets { assets: Map<string, LoadedAsset>; diagnostics: Diagnostic[] }`
  - `check(input: unknown, loaded?: LoadedAssets): CheckResult`, `checkWithAssets(input: unknown, sources: AssetSources): Promise<CheckResult>`
  - `ResolvedVideo.assets: AssetMap`; `resolve(scenefile, assets?)`
  - Diagnostics `ASSET_NOT_FOUND`, `ASSET_UNSUPPORTED`, `ASSET_TOO_LARGE` (errors)
  - Test helper `context(index?: number, total?: number): CompileContext` and `STUB_ASSET`

- [ ] **Step 1: Write the failing tests**

`packages/scenes/test/context.ts`:

```ts
import type { CompileContext } from "../src/types";

/** A 1x1 PNG, reported as 1280x720 so scenes lay it out like a real screenshot. */
export const STUB_ASSET = {
  dataUri:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  width: 1280,
  height: 720,
};

/** A compile context for tests: a landscape 1080p frame in which every image exists. */
export function context(index = 0, total = 1): CompileContext {
  return {
    index,
    total,
    path: `scenes[${index}]`,
    frame: { width: 1920, height: 1080, unit: 10.8 },
    asset: () => STUB_ASSET,
  };
}
```

`packages/engine/test/assets.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ASSET_BYTES, imageInfo, loadAssets } from "../src/assets";

function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  data.writeUInt32BE(0x89504e47, 0);
  data.writeUInt32BE(0x0d0a1a0a, 4);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "latin1");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc2, 0);
  sof.writeUInt16BE(9, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

function webp(width: number, height: number, animated = false): Buffer {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "latin1");
  data.write("WEBP", 8, "latin1");
  data.write("VP8X", 12, "latin1");
  data.writeUInt8(animated ? 0x02 : 0x00, 20);
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}

describe("imageInfo", () => {
  it("reads the type and size of PNG, JPEG and WebP from their bytes", () => {
    expect(imageInfo(png(1280, 720))).toEqual({ mime: "image/png", width: 1280, height: 720 });
    expect(imageInfo(jpeg(800, 600))).toEqual({ mime: "image/jpeg", width: 800, height: 600 });
    expect(imageInfo(webp(640, 480))).toEqual({ mime: "image/webp", width: 640, height: 480 });
  });

  it("rejects what it cannot show as a still image", () => {
    expect(imageInfo(webp(640, 480, true))).toBeNull();
    expect(imageInfo(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBeNull();
    expect(imageInfo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageInfo(Buffer.from("not an image at all"))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
    expect(imageInfo(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("loadAssets", () => {
  const baseDir = "/project/video";
  const files: Record<string, Buffer> = {
    [join(baseDir, "shot.png")]: png(1280, 720),
    [join(baseDir, "img/photo.jpg")]: jpeg(800, 600),
    [join(baseDir, "notes.txt")]: Buffer.from("hello"),
    [join(baseDir, "huge.png")]: Buffer.concat([png(10, 10), Buffer.alloc(MAX_ASSET_BYTES)]),
  };
  const read: string[] = [];
  const readFile = async (path: string): Promise<Buffer> => {
    read.push(path);
    const data = files[path];
    if (!data) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return data;
  };
  const requested: string[] = [];
  const fetchStub = (async (input: URL | string) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/missing.png")) return new Response("no", { status: 404 });
    return new Response(new Uint8Array(png(640, 360)), { status: 200 });
  }) as typeof fetch;
  const load = (src: string, path = "scenes[0].src") =>
    loadAssets([{ path, src }], { baseDir, readFile, fetch: fetchStub });

  it("loads a local image as a data URI with its size", async () => {
    const { assets, diagnostics } = await load("shot.png");
    expect(diagnostics).toEqual([]);
    expect(assets.get("shot.png")).toMatchObject({ mime: "image/png", width: 1280, height: 720 });
    expect(assets.get("shot.png")?.dataUri.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
    expect((await load("img/photo.jpg")).assets.get("img/photo.jpg")).toMatchObject({ width: 800, height: 600 });
  });

  it("loads one image once however many scenes use it", async () => {
    read.length = 0;
    const { assets, diagnostics } = await loadAssets(
      [{ path: "scenes[0].src", src: "shot.png" }, { path: "scenes[3].before.src", src: "shot.png" }],
      { baseDir, readFile, fetch: fetchStub },
    );
    expect(read).toHaveLength(1);
    expect(assets.size).toBe(1);
    expect(diagnostics).toEqual([]);
  });

  it.each(["../secret.png", "/etc/passwd", "img/../../outside.png"])(
    "refuses %s, which is outside the scenefile's folder, without reading it",
    async (src) => {
      read.length = 0;
      const { assets, diagnostics } = await load(src);
      expect(read).toEqual([]);
      expect(assets.size).toBe(0);
      expect(diagnostics).toEqual([
        expect.objectContaining({ code: "ASSET_NOT_FOUND", severity: "error", path: "scenes[0].src" }),
      ]);
      expect(diagnostics[0]?.message).toContain("outside");
    },
  );

  it("reports a missing file at every place it is used", async () => {
    const { diagnostics } = await loadAssets(
      [{ path: "scenes[0].src", src: "nope.png" }, { path: "scenes[2].after.src", src: "nope.png" }],
      { baseDir, readFile, fetch: fetchStub },
    );
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["ASSET_NOT_FOUND", "scenes[0].src"],
      ["ASSET_NOT_FOUND", "scenes[2].after.src"],
    ]);
    expect(diagnostics[0]?.message).toContain("nope.png");
  });

  it("reports files that are not usable images, and images that are too large", async () => {
    expect((await load("notes.txt")).diagnostics[0]).toMatchObject({ code: "ASSET_UNSUPPORTED" });
    expect((await load("notes.txt")).diagnostics[0]?.fix).toMatch(/PNG|JPEG/);
    expect((await load("huge.png")).diagnostics[0]).toMatchObject({ code: "ASSET_TOO_LARGE" });
  });

  it("downloads https images", async () => {
    requested.length = 0;
    const { assets, diagnostics } = await load("https://example.com/a.png");
    expect(diagnostics).toEqual([]);
    expect(requested).toEqual(["https://example.com/a.png"]);
    expect(assets.get("https://example.com/a.png")).toMatchObject({ width: 640, height: 360 });
    expect((await load("https://example.com/missing.png")).diagnostics[0]?.message).toContain("404");
  });

  it.each([
    "http://example.com/a.png",
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://10.0.0.5/a.png",
    "https://192.168.1.1/a.png",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.png",
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
  ])("refuses %s without making a request", async (src) => {
    requested.length = 0;
    read.length = 0;
    const { diagnostics } = await load(src);
    expect(requested).toEqual([]);
    expect(read).toEqual([]);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "ASSET_NOT_FOUND", path: "scenes[0].src" })]);
  });

  it("turns a failed download into a diagnostic", async () => {
    const failing = (async () => {
      throw new Error("getaddrinfo ENOTFOUND nowhere.invalid");
    }) as typeof fetch;
    const { diagnostics } = await loadAssets([{ path: "scenes[0].src", src: "https://nowhere.invalid/a.png" }], {
      baseDir,
      readFile,
      fetch: failing,
    });
    expect(diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND" });
    expect(diagnostics[0]?.message).toContain("ENOTFOUND");
  });
});
```

Tests that build a compile context by hand now use the helper:

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
  el.innerHTML = definition.compile(props, { index: 0, total: 1, path: "scenes[0]" });
====
  el.innerHTML = definition.compile(props, context());
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
import type { MountContext } from "../src/types";
====
import type { MountContext } from "../src/types";
import { context } from "./context";
>>>>
```

```text
FILE packages/scenes/test/conformance.test.ts
<<<<
const at = { index: 2, total: 8, path: "scenes[2]" };
====
const at = context(2, 8);
>>>>
```

```text
FILE packages/scenes/test/conformance.test.ts
<<<<
import { FIXTURES, HOSTILE } from "./fixtures";
====
import { context } from "./context";
import { FIXTURES, HOSTILE } from "./fixtures";
>>>>
```

```text
FILE packages/scenes/test/mounts.test.ts
<<<<
const at = { index: 0, total: 2, path: "scenes[0]" };
====
const at = context(0, 2);
>>>>
```

```text
FILE packages/scenes/test/mounts.test.ts
<<<<
import type { MountContext, SceneHandle } from "../src/types";
====
import type { MountContext, SceneHandle } from "../src/types";
import { context } from "./context";
>>>>
```

```text
FILE packages/scenes/test/terminal.test.ts
<<<<
const ctx = { index: 1, total: 3, path: "scenes[1]" };
====
const ctx = context(1, 3);
>>>>
```

```text
FILE packages/scenes/test/terminal.test.ts
<<<<
import { graphemes, terminalSchedule, typedLength } from "../src/terminal/timing";
====
import { graphemes, terminalSchedule, typedLength } from "../src/terminal/timing";
import { context } from "./context";
>>>>
```

```text
FILE packages/scenes/test/title.test.ts
<<<<
const ctx = { index: 0, total: 8, path: "scenes[0]" };
====
const ctx = context(0, 8);
>>>>
```

```text
FILE packages/scenes/test/title.test.ts
<<<<
    expect(compile({ heading: "x" }, { index: 2, total: 8, path: "scenes[2]" })).toContain("<b>03</b> / 08");
====
    expect(compile({ heading: "x" }, context(2, 8))).toContain("<b>03</b> / 08");
>>>>
```

```text
FILE packages/scenes/test/title.test.ts
<<<<
import { titleSchema } from "../src/title/schema";
====
import { titleSchema } from "../src/title/schema";
import { context } from "./context";
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/assets.test.ts`
Expected: FAIL, cannot resolve `../src/assets`.

- [ ] **Step 3: Implement**

```text
FILE packages/scenes/src/types.ts
<<<<
  /** The scene's path in the scenefile, e.g. `scenes[2]`. */
  readonly path: string;
}
====
  /** The scene's path in the scenefile, e.g. `scenes[2]`. */
  readonly path: string;
  /** The frame in pixels, and one unit (1% of its short side) in pixels. */
  readonly frame: { readonly width: number; readonly height: number; readonly unit: number };
  /** A loaded image, by the `src` the scenefile gave. Undefined if it was not loaded. */
  asset(src: string): SceneAsset | undefined;
}

/** An image ready to draw: embedded data and its real size in pixels. */
export interface SceneAsset {
  readonly dataUri: string;
  readonly width: number;
  readonly height: number;
}
>>>>
```

```text
FILE packages/scenes/src/types.ts
<<<<
  /** Every string the scene draws. */
  texts(props: P): SceneText[];
====
  /** Every string the scene draws. */
  texts(props: P): SceneText[];
  /** Every image the scene shows: its `src`, and the path of the field that names it, relative to the scene. */
  assets?(props: P): { path: string; src: string }[];
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  MountContext,
  SceneDefinition,
====
  MountContext,
  SceneAsset,
  SceneDefinition,
>>>>
```

`packages/engine/src/assets.ts`:

```ts
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
```

```text
FILE packages/engine/src/resolve.ts
<<<<
import { FORMAT_SIZES } from "./formats";
====
import type { AssetMap } from "./assets";
import { FORMAT_SIZES } from "./formats";
>>>>
```

```text
FILE packages/engine/src/resolve.ts
<<<<
  totalFrames: number;
  scenes: ResolvedScene[];
}
====
  totalFrames: number;
  scenes: ResolvedScene[];
  /** Loaded images, by the `src` the scenefile gave. */
  assets: AssetMap;
}
>>>>
```

In `resolve.ts`, change the function's signature and the object it returns:

```text
FILE packages/engine/src/resolve.ts
<<<<
export function resolve(scenefile: Scenefile): { video: ResolvedVideo; diagnostics: Diagnostic[] } {
====
export function resolve(
  scenefile: Scenefile,
  assets: AssetMap = new Map(),
): { video: ResolvedVideo; diagnostics: Diagnostic[] } {
>>>>
```

```text
FILE packages/engine/src/resolve.ts
<<<<
      totalFrames: cursor,
      scenes,
====
      totalFrames: cursor,
      scenes,
      assets,
>>>>
```

```text
FILE packages/engine/src/compile.ts
<<<<
        index: scene.index,
        total,
        path: `scenes[${scene.index}]`,
      });
====
        index: scene.index,
        total,
        path: `scenes[${scene.index}]`,
        frame: { width: video.width, height: video.height, unit: Math.min(video.width, video.height) / 100 },
        asset: (src) => video.assets.get(src),
      });
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
import { type Composition, compile } from "./compile";
====
import { type AssetSources, type LoadedAssets, assetRefs, loadAssets } from "./assets";
import { type Composition, compile } from "./compile";
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
/** Everything that can be checked without a browser: validate, resolve, compile. */
export function check(input: unknown): CheckResult {
====
/**
 * Everything that can be checked without a browser: validate, resolve, compile.
 * Images must be loaded first and passed in; without them, a scenefile that
 * uses images fails with ASSET_NOT_FOUND. `checkWithAssets` does both.
 */
export function check(input: unknown, loaded?: LoadedAssets): CheckResult {
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
  const resolved = resolve(normalized.scenefile);
  const diagnostics = [
    ...normalized.diagnostics,
    ...resolved.diagnostics,
    ...glyphDiagnostics(resolved.video),
  ];
====
  const assetDiagnostics = [...(loaded?.diagnostics ?? [])];
  for (const ref of assetRefs(normalized.scenefile)) {
    const reported = assetDiagnostics.some((diagnostic) => diagnostic.path === ref.path);
    if (!reported && !loaded?.assets.has(ref.src)) {
      assetDiagnostics.push(
        error(
          "ASSET_NOT_FOUND",
          ref.path,
          `The image "${ref.src}" has not been loaded.`,
          "Check the scenefile with the scenefile command, which loads its images.",
        ),
      );
    }
  }

  const resolved = resolve(normalized.scenefile, loaded?.assets);
  const diagnostics = [
    ...normalized.diagnostics,
    ...assetDiagnostics,
    ...resolved.diagnostics,
    ...glyphDiagnostics(resolved.video),
  ];
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
import { type Diagnostic, type Scenefile, hasErrors, normalize } from "@scenefile/schema";
====
import { type Diagnostic, type Scenefile, error, hasErrors, normalize } from "@scenefile/schema";
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
/**
 * Adds what the browser measured to a passing check: layout diagnostics, and
====
/** `check`, after loading the images the scenefile uses. */
export async function checkWithAssets(input: unknown, sources: AssetSources): Promise<CheckResult> {
  const { scenefile } = normalize(input);
  if (!scenefile) return check(input);
  return check(input, await loadAssets(assetRefs(scenefile), sources));
}

/**
 * Adds what the browser measured to a passing check: layout diagnostics, and
>>>>
```

```text
FILE packages/engine/src/index.ts
<<<<
export { type CheckResult, applyLayout, check, storyboard } from "./check";
====
export {
  type AssetMap,
  type AssetRef,
  type AssetSources,
  type LoadedAsset,
  type LoadedAssets,
  MAX_ASSET_BYTES,
  assetRefs,
  imageInfo,
  loadAssets,
} from "./assets";
export { type CheckResult, applyLayout, check, checkWithAssets, storyboard } from "./check";
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
  const checked = check(parsed.value);
====
  const checked = await checkWithAssets(parsed.value, { baseDir: dirname(resolvePath(path)) });
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
import { extname, resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import { type CheckResult, type Composition, type InspectReport, applyLayout, check } from "@scenefile/engine";
====
import { dirname, extname, resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import {
  type CheckResult,
  type Composition,
  type InspectReport,
  applyLayout,
  checkWithAssets,
} from "@scenefile/engine";
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean. No scene uses images yet, so everything else behaves as before.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): load, check and embed images; give scenes the frame and their images"
```

---

### Task 2: `screenshot`

**Files:**
- Create: `packages/scenes/src/image.ts`, `packages/scenes/src/screenshot/{schema,timing,definition,mount}.ts`, `packages/scenes/test/assets/shot.png`, `packages/render/test/images.test.ts`
- Modify: `packages/scenes/src/index.ts`, `packages/scenes/src/browser.ts`, `packages/scenes/test/fixtures.ts`, `packages/scenes/test/conformance.test.ts`, `packages/scenes/test/behaviors.test.ts`, `packages/runtime/src/index.ts`, `packages/engine/src/layout.ts`, `packages/engine/src/check.ts`, `packages/engine/test/layout.test.ts`, `packages/render/test/scenes.test.ts`

**Interfaces:**
- Consumes: `CompileContext.frame`, `CompileContext.asset`, `SceneDefinition.assets`, `checkWithAssets` (Task 1)
- Produces:
  - `containSize(image: { width: number; height: number }, box: { width: number; height: number }): { width: number; height: number }` (whole pixels, aspect kept, fits inside the box)
  - `imageHtml(asset: SceneAsset | undefined, path: string, size: { width: number; height: number }, className: string): string` (an `<img data-sf-image data-sf-path>` or, with no asset, an empty box of that size)
  - `screenshotSchema`, `screenshotDefinition`, `mountScreenshot`, `PIN_START_SECONDS`, `PIN_GAP_SECONDS`, `PIN_FADE_SECONDS`, `pinsRevealSeconds(count: number): number`
  - In the page: `window.__scenefile.report.images: ImageReport[]`
  - `interface ImageReport { path: string; naturalWidth: number; naturalHeight: number; shownWidth: number; shownHeight: number }`; `InspectReport.images?: ImageReport[]`
  - Diagnostic `ASSET_LOW_RES` (warning); storyboard lines for images

- [ ] **Step 1: Make the test image**

Run:

```bash
mkdir -p packages/scenes/test/assets
ffmpeg -y -loglevel error -f lavfi -i "gradients=s=1280x720:c0=0x161616:c1=0x3a3a3a:x0=0:y0=0:x1=1280:y1=720" -frames:v 1 packages/scenes/test/assets/shot.png
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2a2a2a:s=320x180" -frames:v 1 packages/scenes/test/assets/small.png
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2a2a2a:s=400x2400" -frames:v 1 packages/scenes/test/assets/tall.png
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2a2a2a:s=3000x300" -frames:v 1 packages/scenes/test/assets/wide.png
ls -la packages/scenes/test/assets
```

Expected: four PNG files, each a few kilobytes.

- [ ] **Step 2: Write the failing tests**

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
====
  screenshot: {
    type: "screenshot",
    src: "assets/shot.png",
    url: "scenefile.dev/gallery",
    caption: "Every frame comes from one file.",
    callouts: [{ x: 0.25, y: 0.3, label: "Scene counter" }, { x: 0.7, y: 0.6, label: "Fitted text" }],
  },
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
>>>>
```

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
====
  screenshot: { type: "screenshot", src: NASTY, url: NASTY, caption: NASTY, callouts: [{ x: 0.5, y: 0.5, label: SHORT_NASTY }] },
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
>>>>
```

```text
FILE packages/scenes/test/fixtures.ts
<<<<
/** The same scenes with markup in every text field. None of it may become an element. */
====
const SHORT_NASTY = `<u>x</u>&"'<img src=x>`;

/** The same scenes with markup in every text field. None of it may become an element. */
>>>>
```

Fixed-size labels are allowed outside fitted slots when they say so:

```text
FILE packages/scenes/test/conformance.test.ts
<<<<
    const fitted = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-fit]"), (slot) => {
====
    // Text is either fitted, or explicitly marked as a fixed-size label.
    const fitted = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-fit], [data-sf-fixed]"), (slot) => {
>>>>
```

```text
FILE packages/scenes/test/conformance.test.ts
<<<<
  it("describes itself in one line and holds for a positive, finite time", () => {
====
  it("draws each image it declares, sized in whole pixels, with a path to the field that names it", () => {
    const { props, definition, el } = build(type, FIXTURES[type]);
    const declared = (definition.assets?.(props) ?? []).map((ref) => `scenes[2].${ref.path}`);
    const images = Array.from(el.querySelectorAll<HTMLImageElement>("img"));
    expect(images.map((image) => image.dataset.sfPath).sort()).toEqual([...declared].sort());
    for (const image of images) {
      expect("sfImage" in image.dataset).toBe(true);
      expect(image.getAttribute("src")?.startsWith("data:image/")).toBe(true);
      for (const side of ["width", "height"] as const) {
        const value = Number(image.getAttribute(side));
        expect(Number.isInteger(value) && value > 0, `${side}=${image.getAttribute(side)}`).toBe(true);
      }
    }
  });

  it("describes itself in one line and holds for a positive, finite time", () => {
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
describe("quote", () => {
====
describe("images", () => {
  it.each([
    [{ width: 1280, height: 720 }, { width: 1000, height: 1000 }, { width: 1000, height: 563 }],
    [{ width: 400, height: 2400 }, { width: 1000, height: 600 }, { width: 100, height: 600 }],
    [{ width: 3000, height: 300 }, { width: 1000, height: 600 }, { width: 1000, height: 100 }],
    [{ width: 320, height: 180 }, { width: 1600, height: 900 }, { width: 1600, height: 900 }],
    [{ width: 1, height: 5000 }, { width: 800, height: 600 }, { width: 1, height: 600 }],
  ])("fits %j inside %j as %j", (image, box, expected) => {
    const size = containSize(image, box);
    expect(size).toEqual(expected);
    expect(size.width).toBeLessThanOrEqual(box.width);
    expect(size.height).toBeLessThanOrEqual(box.height);
  });
});

describe("screenshot", () => {
  const input = {
    type: "screenshot",
    src: "shot.png",
    url: "scenefile.dev",
    caption: "One file.",
    callouts: [{ x: 0.25, y: 0.3, label: "First" }, { x: 0.8, y: 0.6, label: "Second" }],
  };

  it("declares its image and its text", () => {
    const { props, definition } = stage(input);
    expect(definition.assets?.(props)).toEqual([{ path: "src", src: "shot.png" }]);
    expect(definition.texts(props).map((entry) => entry.path)).toEqual(["url", "caption", "callouts[0].label", "callouts[1].label"]);
  });

  it("allows at most three callouts, each inside the image", () => {
    const pin = { x: 0.5, y: 0.5, label: "x" };
    expect(sceneSchema.safeParse({ type: "screenshot", src: "a.png", callouts: [pin, pin, pin, pin] }).success).toBe(false);
    expect(sceneSchema.safeParse({ type: "screenshot", src: "a.png", callouts: [{ ...pin, x: 1.2 }] }).success).toBe(false);
    expect(sceneSchema.safeParse({ type: "screenshot", src: "a.png" }).success).toBe(true);
  });

  it("places each callout by its fraction of the image, labels to the left when near the right edge", () => {
    const { el } = stage(input);
    const pins = all(el, "[data-sf-pin]");
    expect(pins.map((pin) => [pin.style.left, pin.style.top])).toEqual([["25%", "30%"], ["80%", "60%"]]);
    expect(pins.map((pin) => pin.classList.contains("is-left"))).toEqual([false, true]);
    expect(pins.map((pin) => pin.textContent)).toEqual(["First", "Second"]);
  });

  it("sizes the image to its area: 1280x720 in a landscape frame keeps its shape", () => {
    const { el } = stage(input);
    const image = el.querySelector("img");
    const width = Number(image?.getAttribute("width"));
    const height = Number(image?.getAttribute("height"));
    expect(width / height).toBeCloseTo(1280 / 720, 2);
    expect(width).toBeLessThanOrEqual(1920 - 18 * 10.8);
    expect(height).toBeLessThanOrEqual(1080 - 25 * 10.8);
  });

  it("reveals callouts one after another and slowly moves in on the image", () => {
    const { el, ctx, handle, revealed } = stage(input);
    const pins = all(el, "[data-sf-pin]");
    const layer = el.querySelector<HTMLElement>(".sf-shot__layer");
    handle.seek(ctx.enterFrames + Math.round((PIN_START_SECONDS + 0.2) * FPS));
    expect(Number(pins[0]?.style.opacity)).toBeGreaterThan(0);
    expect(Number(pins[1]?.style.opacity)).toBe(0);
    const early = layer?.style.transform;
    handle.seek(revealed);
    expect(pins.every((pin) => pin.style.opacity === "1")).toBe(true);
    expect(layer?.style.transform).not.toBe(early);
    expect(layer?.style.transform).toMatch(/^scale\(1\.0\d+\)$/);
    expect(pinsRevealSeconds(2)).toBeCloseTo(PIN_START_SECONDS + PIN_GAP_SECONDS + PIN_FADE_SECONDS);
    expect(pinsRevealSeconds(0)).toBe(0);
  });

  it("draws an empty frame of the right size when the image is not available", () => {
    const props = sceneSchema.parse({ type: "screenshot", src: "gone.png" });
    const html = getScene("screenshot").compile(props, { ...context(), asset: () => undefined });
    expect(html).not.toContain("<img");
    expect(html).toContain("sf-shot__missing");
  });
});

describe("quote", () => {
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
import { COUNT_SECONDS, statText } from "../src/stat/timing";
====
import { containSize } from "../src/image";
import { PIN_FADE_SECONDS, PIN_GAP_SECONDS, PIN_START_SECONDS, pinsRevealSeconds } from "../src/screenshot/timing";
import { COUNT_SECONDS, statText } from "../src/stat/timing";
>>>>
```

Layout tests for images:

```text
FILE packages/engine/test/layout.test.ts
<<<<
describe("applyLayout", () => {
====
describe("images", () => {
  const image = (over: Partial<ImageReport>): ImageReport => ({
    path: "scenes[0].src", naturalWidth: 1280, naturalHeight: 720, shownWidth: 1280, shownHeight: 720, ...over,
  });

  it("accepts an image shown at or near its own size", () => {
    expect(verifyLayout({ slots: [], images: [image({}), image({ shownWidth: 1500, shownHeight: 844 })] })).toEqual([]);
  });

  it("warns when an image is stretched well beyond its own size, and says what size is needed", () => {
    const [diagnostic, ...rest] = verifyLayout({
      slots: [],
      images: [image({ naturalWidth: 320, naturalHeight: 180, shownWidth: 1600, shownHeight: 900 })],
    });
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ code: "ASSET_LOW_RES", severity: "warning", path: "scenes[0].src" });
    expect(diagnostic?.message).toContain("320x180");
    expect(diagnostic?.message).toContain("1600x900");
    expect(diagnostic?.fix).toContain("1600");
  });
});

describe("applyLayout", () => {
>>>>
```

```text
FILE packages/engine/test/layout.test.ts
<<<<
import { type SlotReport, verifyLayout } from "../src/layout";
====
import { type ImageReport, type SlotReport, verifyLayout } from "../src/layout";
>>>>
```

`packages/render/test/images.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { applyLayout, checkWithAssets, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { captureFrame, inspectComposition, openComposition } from "../src/index";

const baseDir = fileURLToPath(new URL("../../scenes/test", import.meta.url));
const filler = { type: "title", heading: "one two three four five six seven eight nine" };

async function compose(input: Record<string, unknown>) {
  const result = await checkWithAssets({ version: 1, ...input }, { baseDir });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return { result, composition: result.composition };
}

describe("images in a real browser", () => {
  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])(
    "shows tall, wide and ordinary images whole, inside the frame, in %s",
    async (format) => {
      const { composition } = await compose({
        format,
        scenes: ["shot.png", "tall.png", "wide.png"].map((name) => ({
          type: "screenshot",
          src: `assets/${name}`,
          url: "scenefile.dev",
          caption: "A caption under the image.",
        })),
      });
      const { width, height } = composition.manifest;
      const session = await openComposition(composition);
      try {
        for (const scene of composition.manifest.scenes) {
          await captureFrame(session.page, scene.startFrame + scene.enterFrames + 5);
          const box = await session.page.evaluate(() => {
            const visible = document.querySelector(".sf-scene:not([hidden])");
            const image = visible?.querySelector("img");
            const view = visible?.querySelector(".sf-shot__view");
            const caption = visible?.querySelector(".sf-shot__caption");
            const chrome = visible?.querySelector(".sf-chrome");
            if (!image || !view || !caption || !chrome) return null;
            const rect = view.getBoundingClientRect();
            return {
              left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              complete: image.complete && image.naturalWidth > 0,
              ratio: image.naturalWidth / image.naturalHeight,
              captionTop: caption.getBoundingClientRect().top,
              chromeBottom: chrome.getBoundingClientRect().bottom,
            };
          });
          if (!box) throw new Error("scene is missing its image, caption or counter");
          expect(box.complete).toBe(true);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(box.top).toBeGreaterThan(box.chromeBottom);
          expect(box.bottom).toBeLessThanOrEqual(box.captionTop + 1);
          expect(box.bottom).toBeLessThanOrEqual(height);
          // Shown whole: the box has the image's own shape (within a pixel of rounding).
          const shownRatio = (box.right - box.left) / (box.bottom - box.top);
          expect(Math.abs(shownRatio - box.ratio) / box.ratio).toBeLessThan(0.03);
        }
      } finally {
        await session.close();
      }
    },
  );

  it("reports the size each image is shown at, and warns when a small one is stretched", async () => {
    const { result, composition } = await compose({
      scenes: [{ type: "screenshot", src: "assets/shot.png" }, { type: "screenshot", src: "assets/small.png" }, filler],
    });
    const report = await inspectComposition(composition);
    expect(report.images?.map((image) => [image.path, image.naturalWidth, image.naturalHeight])).toEqual([
      ["scenes[0].src", 1280, 720],
      ["scenes[1].src", 320, 180],
    ]);
    const diagnostics = verifyLayout(report);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "ASSET_LOW_RES", severity: "warning", path: "scenes[1].src" }),
    ]);
    const laidOut = applyLayout(result, report);
    expect(laidOut.ok).toBe(true);
    expect(laidOut.storyboard).toMatch(/src\s+1280x720 image, shown at \d+x\d+/);
  });

  it("fails the check, without rendering, when an image cannot be loaded", async () => {
    const result = await checkWithAssets(
      { version: 1, scenes: [{ type: "screenshot", src: "assets/nope.png" }, { type: "screenshot", src: "../../README.md" }, filler] },
      { baseDir },
    );
    expect(result.ok).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["ASSET_NOT_FOUND", "scenes[0].src"],
      ["ASSET_NOT_FOUND", "scenes[1].src"],
    ]);
  });
});
```

The all-scenes tests must load images now:

```text
FILE packages/render/test/scenes.test.ts
<<<<
import { type Composition, check, verifyLayout } from "@scenefile/engine";
====
import { fileURLToPath } from "node:url";
import { type Composition, check, checkWithAssets, verifyLayout } from "@scenefile/engine";
>>>>
```

```text
FILE packages/render/test/scenes.test.ts
<<<<
function compose(format: string): Composition {
  const result = check({ version: 1, format, scenes: ALL_SCENES });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}
====
const baseDir = fileURLToPath(new URL("../../scenes/test", import.meta.url));

async function compose(format: string): Promise<Composition> {
  const result = await checkWithAssets({ version: 1, format, scenes: ALL_SCENES }, { baseDir });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}
>>>>
```

```text
FILE packages/render/test/scenes.test.ts
<<<<
    const report = await inspectComposition(compose(format));
    expect(verifyLayout(report)).toEqual([]);
====
    const report = await inspectComposition(await compose(format));
    expect(verifyLayout(report).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
>>>>
```

```text
FILE packages/render/test/scenes.test.ts
<<<<
    const composition = compose("landscape-1080p");
    const total = composition.manifest.totalFrames;
====
    const composition = await compose("landscape-1080p");
    const total = composition.manifest.totalFrames;
>>>>
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/scenes packages/engine`
Expected: FAIL. `behaviors.test.ts` cannot resolve `../src/image`; fixtures name a scene type that does not exist; `layout.test.ts` cannot import `ImageReport`.

- [ ] **Step 4: Implement**

`packages/scenes/src/image.ts`:

```ts
import type { SceneAsset } from "./types";

interface Size {
  width: number;
  height: number;
}

/**
 * The largest size, in whole pixels, at which an image fits inside a box
 * without changing shape. A small image is enlarged to fill the box; that is
 * reported separately as low resolution.
 */
export function containSize(image: Size, box: Size): Size {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  return {
    width: Math.max(1, Math.min(Math.floor(box.width), Math.round(image.width * scale))),
    height: Math.max(1, Math.min(Math.floor(box.height), Math.round(image.height * scale))),
  };
}

/**
 * An image at an exact size, marked so the runtime decodes it before drawing
 * and reports how large it is shown. With no asset, an empty box of that size.
 */
export function imageHtml(asset: SceneAsset | undefined, path: string, size: Size, className: string): string {
  if (!asset) return `<div class="${className} sf-shot__missing" style="width:${size.width}px;height:${size.height}px"></div>`;
  return `<img class="${className}" data-sf-image data-sf-path="${path}" src="${asset.dataUri}" width="${size.width}" height="${size.height}" alt="">`;
}
```

`packages/scenes/src/screenshot/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

const calloutSchema = z.strictObject({
  /** Where the callout points: 0 is the image's left edge, 1 its right. */
  x: z.number().min(0).max(1),
  /** 0 is the image's top edge, 1 its bottom. */
  y: z.number().min(0).max(1),
  label: z.string().min(1).max(40),
});

export const screenshotSchema = z.strictObject({
  type: z.literal("screenshot"),
  /** The image: a file beside the scenefile, or an https address. */
  src: z.string().min(1).max(2000),
  /** An address to show above the image, as in a browser. */
  url: z.string().min(1).max(80).optional(),
  caption: z.string().min(1).max(80).optional(),
  callouts: z.array(calloutSchema).min(1).max(3).optional(),
  duration: durationSchema.default("auto"),
});

export type ScreenshotProps = z.infer<typeof screenshotSchema>;
```

`packages/scenes/src/screenshot/timing.ts`:

```ts
/** Seconds after the scene has entered before the first callout appears. */
export const PIN_START_SECONDS = 0.6;
export const PIN_GAP_SECONDS = 0.9;
export const PIN_FADE_SECONDS = 0.35;
/** How far the view moves in on the image over the whole scene. */
export const ZOOM = 0.04;

/** Seconds, after entering, until the last callout is fully shown. */
export function pinsRevealSeconds(count: number): number {
  return count === 0 ? 0 : PIN_START_SECONDS + (count - 1) * PIN_GAP_SECONDS + PIN_FADE_SECONDS;
}
```

`packages/scenes/src/screenshot/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { containSize, imageHtml } from "../image";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type ScreenshotProps, screenshotSchema } from "./schema";
import { pinsRevealSeconds } from "./timing";

/** Layout, in units. The image gets whatever the frame leaves after these. */
const TOP = 17;
const BOTTOM = 8;
const SIDE = 9;
const BAR = 5;
const CAPTION = 9;
/** A callout this far right puts its label on the left, so it stays inside the image. */
const LABEL_FLIPS_AT = 0.6;

/** A fraction as a CSS percentage, without floating-point noise (0.3 is "30%", not "30.000000000000004%"). */
function percent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

export const screenshotDefinition: SceneDefinition<ScreenshotProps> = {
  type: "screenshot",
  fields: Object.keys(screenshotSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.4,
  minHoldSeconds: 3,
  revealSeconds: (props) => pinsRevealSeconds(props.callouts?.length ?? 0),
  holdSeconds(props) {
    const labels = (props.callouts ?? []).map((callout) => callout.label).join(" ");
    return pinsRevealSeconds(props.callouts?.length ?? 0) + readingSeconds(`${labels} ${props.caption ?? ""}`) + 1.5;
  },
  summary: (props) => `image ${props.src}${props.caption ? `: ${props.caption}` : ""}`,
  texts(props) {
    const texts: SceneText[] = [];
    if (props.url) texts.push({ path: "url", text: props.url, font: "mono" });
    if (props.caption) texts.push({ path: "caption", text: props.caption, font: "sans" });
    (props.callouts ?? []).forEach((callout, i) => texts.push({ path: `callouts[${i}].label`, text: callout.label, font: "sans" }));
    return texts;
  },
  assets: (props) => [{ path: "src", src: props.src }],
  compile(props, ctx) {
    const { width, height, unit } = ctx.frame;
    const asset = ctx.asset(props.src);
    const box = {
      width: width - 2 * SIDE * unit,
      height: height - (TOP + BOTTOM + (props.url ? BAR : 0) + (props.caption ? CAPTION : 0)) * unit,
    };
    // 16:9 stands in for an image that is not available, so the layout still holds.
    const size = containSize(asset ?? { width: 16, height: 9 }, box);
    const pins = (props.callouts ?? [])
      .map(
        (callout, i) =>
          `<span class="sf-shot__pin${callout.x > LABEL_FLIPS_AT ? " is-left" : ""}" data-sf-pin="${i}" style="left:${percent(callout.x)};top:${percent(callout.y)}"><b data-sf-fixed>${escapeHtml(callout.label)}</b></span>`,
      )
      .join("");
    const bar = props.url ? `<div class="sf-shot__bar" data-sf-fixed>${escapeHtml(props.url)}</div>` : "";
    const caption = props.caption
      ? `<p class="sf-shot__caption" data-sf-enter="1" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.caption">${escapeHtml(props.caption)}</p>`
      : "";
    return `${sceneChrome(ctx)}<div class="sf-shot"><figure class="sf-shot__frame" data-sf-enter="0" style="width:${size.width}px">${bar}<div class="sf-shot__view" style="width:${size.width}px;height:${size.height}px"><div class="sf-shot__layer">${imageHtml(asset, `${ctx.path}.src`, size, "sf-shot__img")}${pins}</div></div></figure>${caption}</div>`;
  },
  css: `
.sf-shot{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*17);bottom:calc(var(--sf-unit)*8);display:flex;flex-direction:column;justify-content:space-between}
.sf-shot__frame{box-sizing:content-box;border:1px solid var(--sf-line);margin:-1px}
.sf-shot__bar{height:calc(var(--sf-unit)*5);padding:0 calc(var(--sf-unit)*2);border-bottom:1px solid var(--sf-line);font:500 calc(var(--sf-unit)*2.4)/calc(var(--sf-unit)*5) var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-shot__view{position:relative;overflow:hidden;background:var(--sf-surface)}
.sf-shot__layer{position:absolute;inset:0}
.sf-shot__img,.sf-shot__missing{display:block}
.sf-shot__pin{position:absolute;width:0;height:0}
.sf-shot__pin::before{content:"";position:absolute;left:calc(var(--sf-unit)*-1);top:calc(var(--sf-unit)*-1);width:calc(var(--sf-unit)*2);height:calc(var(--sf-unit)*2);border-radius:50%;background:var(--sf-accent);box-shadow:0 0 0 calc(var(--sf-unit)*0.5) var(--sf-bg)}
.sf-shot__pin b{position:absolute;left:calc(var(--sf-unit)*2.6);top:calc(var(--sf-unit)*-2.6);padding:0 calc(var(--sf-unit)*1.4);background:var(--sf-bg);border:1px solid var(--sf-line);font:600 calc(var(--sf-unit)*3.4)/calc(var(--sf-unit)*5.2) var(--sf-font-sans);color:var(--sf-text);white-space:nowrap}
.sf-shot__pin.is-left b{left:auto;right:calc(var(--sf-unit)*2.6)}
.sf-shot__caption{font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
`,
};
```

`packages/scenes/src/screenshot/mount.ts`:

```ts
import { clamp01, fadeExit, reveal, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { PIN_FADE_SECONDS, PIN_GAP_SECONDS, PIN_START_SECONDS, ZOOM } from "./timing";

const PIN_OFFSET_PX = 16;

export const mountScreenshot: SceneMount = (el, ctx) => {
  const layer = el.querySelector<HTMLElement>(".sf-shot__layer");
  const pins = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-pin]"));
  const fade = PIN_FADE_SECONDS * ctx.fps;
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      // A slow, steady move in: an image that sits perfectly still reads as a slide.
      if (layer) {
        const progress = clamp01(frame / Math.max(1, ctx.durationFrames - 1));
        layer.style.transform = `scale(${(1 + ZOOM * progress).toFixed(4)})`;
      }
      pins.forEach((pin, i) => {
        const start = ctx.enterFrames + (PIN_START_SECONDS + i * PIN_GAP_SECONDS) * ctx.fps;
        reveal(pin, frame, start, fade, PIN_OFFSET_PX);
      });
    },
  };
};
```

Register it, keeping `terminal` last:

```text
FILE packages/scenes/src/index.ts
<<<<
import { quoteSchema } from "./quote/schema";
====
import { quoteSchema } from "./quote/schema";
import { screenshotDefinition } from "./screenshot/definition";
import { screenshotSchema } from "./screenshot/schema";
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  outroSchema,
  terminalSchema,
]);
====
  outroSchema,
  screenshotSchema,
  terminalSchema,
]);
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  outro: widen(outroDefinition),
  terminal: widen(terminalDefinition),
====
  outro: widen(outroDefinition),
  screenshot: widen(screenshotDefinition),
  terminal: widen(terminalDefinition),
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
import { mountQuote } from "./quote/mount";
====
import { mountQuote } from "./quote/mount";
import { mountScreenshot } from "./screenshot/mount";
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
  outro: mountOutro,
  terminal: mountTerminal,
====
  outro: mountOutro,
  screenshot: mountScreenshot,
  terminal: mountTerminal,
>>>>
```

Runtime: decode images first, and report how large each is shown.

```text
FILE packages/runtime/src/index.ts
<<<<
  report: { slots: SlotReport[]; crowded: number[] };
====
  report: { slots: SlotReport[]; crowded: number[]; images: ImageReport[] };
>>>>
```

```text
FILE packages/runtime/src/index.ts
<<<<
interface Mounted {
====
/** How an image ended up on screen. Mirrors `ImageReport` in @scenefile/engine. */
interface ImageReport {
  path: string;
  naturalWidth: number;
  naturalHeight: number;
  shownWidth: number;
  shownHeight: number;
}

interface Mounted {
>>>>
```

```text
FILE packages/runtime/src/index.ts
<<<<
    if (isCrowded(el)) crowded.push(scene.index);
    el.hidden = true;
  }
====
    if (isCrowded(el)) crowded.push(scene.index);
    for (const image of el.querySelectorAll<HTMLImageElement>("img[data-sf-image]")) {
      images.push({
        path: image.dataset.sfPath ?? "",
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        // The laid-out size, not the on-screen one: a scene may be mid-zoom.
        shownWidth: image.offsetWidth,
        shownHeight: image.offsetHeight,
      });
    }
    el.hidden = true;
  }
>>>>
```

```text
FILE packages/runtime/src/index.ts
<<<<
  const crowded: number[] = [];
====
  const crowded: number[] = [];
  const images: ImageReport[] = [];
>>>>
```

```text
FILE packages/runtime/src/index.ts
<<<<
    report: { slots, crowded },
====
    report: { slots, crowded, images },
>>>>
```

```text
FILE packages/runtime/src/index.ts
<<<<
  await Promise.all(Array.from(document.fonts, (face) => face.load()));
====
  await Promise.all(Array.from(document.fonts, (face) => face.load()));
  // Images decode off the main thread; a frame captured before they finish would show a blank box.
  await Promise.all(Array.from(document.images, (image) => image.decode()));
>>>>
```

Engine: the report type, the warning, and the storyboard line.

```text
FILE packages/engine/src/layout.ts
<<<<
export interface InspectReport {
  slots: SlotReport[];
====
/** What the browser reports for one image. */
export interface ImageReport {
  /** Scenefile path of the field naming the image, e.g. `scenes[2].src`. */
  path: string;
  naturalWidth: number;
  naturalHeight: number;
  /** The size the image is laid out at, in frame pixels. */
  shownWidth: number;
  shownHeight: number;
}

/** An image may be enlarged this much before it is called soft. */
const MAX_UPSCALE = 1.25;

export interface InspectReport {
  slots: SlotReport[];
  images?: ImageReport[];
>>>>
```

```text
FILE packages/engine/src/layout.ts
<<<<
  for (const index of report.crowded ?? []) {
====
  for (const image of report.images ?? []) {
    if (image.shownWidth > image.naturalWidth * MAX_UPSCALE) {
      diagnostics.push(
        warning(
          "ASSET_LOW_RES",
          image.path,
          `This image is ${image.naturalWidth}x${image.naturalHeight} pixels but is shown at ${image.shownWidth}x${image.shownHeight}, so it will look soft.`,
          `Use an image at least ${image.shownWidth} pixels wide.`,
        ),
      );
    }
  }
  for (const index of report.crowded ?? []) {
>>>>
```

```text
FILE packages/engine/src/layout.ts
<<<<
import { type Diagnostic, error } from "@scenefile/schema";
====
import { type Diagnostic, error, warning } from "@scenefile/schema";
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
    const fieldWidth = Math.max(0, ...slots.map((slot) => slot.path.length - prefix.length));
====
    const images = (report?.images ?? []).filter((image) => image.path.startsWith(prefix));
    const fieldWidth = Math.max(0, ...[...slots, ...images].map((entry) => entry.path.length - prefix.length));
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
      lines.push(`     ${field}  ${Math.round(slot.sizePx)}px${count}`);
    }
====
      lines.push(`     ${field}  ${Math.round(slot.sizePx)}px${count}`);
    }
    for (const image of images) {
      const field = image.path.slice(prefix.length).padEnd(fieldWidth);
      lines.push(
        `     ${field}  ${image.naturalWidth}x${image.naturalHeight} image, shown at ${image.shownWidth}x${image.shownHeight}`,
      );
    }
>>>>
```

```text
FILE packages/engine/src/index.ts
<<<<
export { type InspectReport, type SlotReport, verifyLayout } from "./layout";
====
export { type ImageReport, type InspectReport, type SlotReport, verifyLayout } from "./layout";
>>>>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean, including the pixel-reproducibility tests with an image and a scale transform in the mix.

If an image test reports the box overlapping the caption or the counter, the constants in `screenshot/definition.ts` (`TOP`, `BOTTOM`, `BAR`, `CAPTION`) do not match the CSS. Fix whichever is wrong so the two agree; do not loosen the test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scenes): screenshot scene with callouts; low-resolution warning and image lines in the storyboard"
```

---

### Task 3: `compare`, examples, and review by eye

**Files:**
- Create: `packages/scenes/src/compare/{schema,timing,definition,mount}.ts`, `examples/screenshot.json`, `examples/assets/frame.png`
- Modify: `packages/scenes/src/index.ts`, `packages/scenes/src/browser.ts`, `packages/scenes/test/fixtures.ts`, `packages/scenes/test/behaviors.test.ts`, `packages/render/test/images.test.ts`, `examples/launch.json`, `README.md`

**Interfaces:**
- Consumes: `containSize`, `imageHtml`, `reveal`, `clamp01`, `easeOutCubic`
- Produces: `compareSchema`, `compareDefinition`, `mountCompare`, `AFTER_DELAY_SECONDS`, `SIDE_FADE_SECONDS`

- [ ] **Step 1: Write the failing tests**

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
====
  compare: {
    type: "compare",
    before: { text: "Forty lines of animation code the model cannot check." },
    after: { label: "With scenefile", text: "Six lines of JSON it can." },
  },
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
>>>>
```

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
====
  compare: { type: "compare", before: { label: SHORT_NASTY, text: NASTY }, after: { label: SHORT_NASTY, src: NASTY } },
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
describe("quote", () => {
====
describe("compare", () => {
  const input = { type: "compare", before: { text: "Slow and manual." }, after: { label: "Now", text: "One command." } };

  it("needs exactly one of text or image on each side", () => {
    expect(sceneSchema.safeParse(input).success).toBe(true);
    expect(sceneSchema.safeParse({ ...input, after: { label: "Now" } }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...input, after: { text: "a", src: "b.png" } }).success).toBe(false);
    expect(sceneSchema.safeParse({ type: "compare", before: { src: "a.png" }, after: { src: "b.png" } }).success).toBe(true);
  });

  it("labels the sides Before and After unless told otherwise", () => {
    const { el } = stage(input);
    expect(all(el, ".sf-compare__label").map((label) => label.textContent)).toEqual(["Before", "Now"]);
  });

  it("declares its text and its images, with paths into each side", () => {
    const text = stage(input);
    expect(text.definition.texts(text.props).map((entry) => entry.path)).toEqual(["before.text", "after.label", "after.text"]);
    expect(text.definition.assets?.(text.props)).toEqual([]);
    const images = stage({ type: "compare", before: { src: "a.png" }, after: { src: "b.png" } });
    expect(images.definition.assets?.(images.props)).toEqual([{ path: "before.src", src: "a.png" }, { path: "after.src", src: "b.png" }]);
    expect(all(images.el, "img").map((image) => image.dataset.sfPath)).toEqual(["scenes[0].before.src", "scenes[0].after.src"]);
  });

  it("shows the before side first, then brings in the after side and lets the before side recede", () => {
    const { el, ctx, handle, revealed } = stage(input);
    const [before, after] = all(el, "[data-sf-side]");
    if (!before || !after) throw new Error("missing sides");
    handle.seek(ctx.enterFrames + 6);
    expect(Number(before.style.opacity)).toBeGreaterThan(0.5);
    expect(Number(after.style.opacity)).toBe(0);
    handle.seek(revealed);
    expect(after.style.opacity).toBe("1");
    expect(Number(before.style.opacity)).toBeLessThan(0.6);
    expect(Number(before.style.opacity)).toBeGreaterThan(0.3);
  });

  it("gives two images equal boxes side by side", () => {
    const { el } = stage({ type: "compare", before: { src: "a.png" }, after: { src: "b.png" } });
    const [first, second] = all(el, "img");
    expect(first?.getAttribute("width")).toBe(second?.getAttribute("width"));
    expect(Number(first?.getAttribute("width"))).toBeLessThanOrEqual((1920 - 18 * 10.8 - 6 * 10.8) / 2);
  });
});

describe("quote", () => {
>>>>
```

```text
FILE packages/render/test/images.test.ts
<<<<
  it("reports the size each image is shown at, and warns when a small one is stretched", async () => {
====
  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])(
    "keeps both sides of a comparison inside the frame and apart, in %s",
    async (format) => {
      const { composition } = await compose({
        format,
        scenes: [
          { type: "compare", before: { src: "assets/tall.png" }, after: { src: "assets/wide.png" } },
          { type: "compare", before: { text: "Forty lines of animation code the model cannot check." }, after: { src: "assets/shot.png" } },
        ],
      });
      expect(verifyLayout(await inspectComposition(composition)).filter((d) => d.severity === "error")).toEqual([]);
      const { width, height } = composition.manifest;
      const session = await openComposition(composition);
      try {
        for (const scene of composition.manifest.scenes) {
          await captureFrame(session.page, scene.startFrame + scene.durationFrames - scene.exitFrames - 1);
          const sides = await session.page.evaluate(() => {
            const visible = document.querySelector(".sf-scene:not([hidden])");
            const chromeBottom = visible?.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
            return Array.from(visible?.querySelectorAll(".sf-compare__body") ?? [], (body) => {
              const rect = (body.firstElementChild ?? body).getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, chromeBottom };
            });
          });
          expect(sides).toHaveLength(2);
          for (const side of sides) {
            expect(side.left).toBeGreaterThanOrEqual(0);
            expect(side.right).toBeLessThanOrEqual(width);
            expect(side.top).toBeGreaterThan(side.chromeBottom);
            expect(side.bottom).toBeLessThanOrEqual(height);
          }
          const [a, b] = sides;
          if (!a || !b) throw new Error("missing sides");
          const apart = a.right <= b.left + 1 || a.bottom <= b.top + 1;
          expect(apart).toBe(true);
        }
      } finally {
        await session.close();
      }
    },
  );

  it("reports the size each image is shown at, and warns when a small one is stretched", async () => {
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/scenes`
Expected: FAIL: `compare` is not a known scene type.

- [ ] **Step 3: Implement**

`packages/scenes/src/compare/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

const sideSchema = z
  .strictObject({
    /** A short name for this side. Defaults to "Before" or "After". */
    label: z.string().min(1).max(24).optional(),
    text: z.string().min(1).max(160).optional(),
    /** An image: a file beside the scenefile, or an https address. */
    src: z.string().min(1).max(2000).optional(),
  })
  .refine((side) => (side.text === undefined) !== (side.src === undefined), {
    message: 'Give this side either "text" or "src": one of them, not both.',
  });

export const compareSchema = z.strictObject({
  type: z.literal("compare"),
  before: sideSchema,
  after: sideSchema,
  duration: durationSchema.default("auto"),
});

export type CompareProps = z.infer<typeof compareSchema>;
export type CompareSide = z.infer<typeof sideSchema>;
```

`packages/scenes/src/compare/timing.ts`:

```ts
/** Seconds after the scene has entered before the after side appears. */
export const AFTER_DELAY_SECONDS = 0.9;
export const SIDE_FADE_SECONDS = 0.45;
/** How visible the before side stays once the after side is in. */
export const RECEDED = 0.45;
```

`packages/scenes/src/compare/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { containSize, imageHtml } from "../image";
import { escapeHtml, readingSeconds } from "../text";
import type { CompileContext, SceneDefinition, SceneText } from "../types";
import { type CompareProps, type CompareSide, compareSchema } from "./schema";
import { AFTER_DELAY_SECONDS, SIDE_FADE_SECONDS } from "./timing";

/** Layout, in units. Must agree with the CSS below. */
const TOP = 19;
const BOTTOM = 9;
const SIDE = 9;
const GAP = 6;
const LABEL = 7;

const SIDES = [
  { key: "before", fallback: "Before" },
  { key: "after", fallback: "After" },
] as const;

/** The space one side's image may fill: half the width side by side, half the height when stacked. */
function imageBox(ctx: CompileContext): { width: number; height: number } {
  const { width, height, unit } = ctx.frame;
  // Must agree with the CSS, which stacks the sides when the frame is square or taller.
  const stacked = height >= width;
  const innerWidth = width - 2 * SIDE * unit;
  const innerHeight = height - (TOP + BOTTOM) * unit;
  return stacked
    ? { width: innerWidth, height: (innerHeight - GAP * unit) / 2 - LABEL * unit }
    : { width: (innerWidth - GAP * unit) / 2, height: innerHeight - LABEL * unit };
}

function sideHtml(side: CompareSide, key: "before" | "after", fallback: string, index: number, ctx: CompileContext): string {
  const body =
    side.src !== undefined
      ? imageHtml(
          ctx.asset(side.src),
          `${ctx.path}.${key}.src`,
          containSize(ctx.asset(side.src) ?? { width: 16, height: 9 }, imageBox(ctx)),
          "sf-compare__img",
        )
      : `<p class="sf-compare__text" data-sf-fit="4.6,9,0.4" data-sf-lines="6" data-sf-path="${ctx.path}.${key}.text">${escapeHtml(side.text ?? "")}</p>`;
  return `<section class="sf-compare__side is-${key}" data-sf-side="${index}"><p class="sf-compare__label" data-sf-fixed>${escapeHtml(side.label ?? fallback)}</p><div class="sf-compare__body">${body}</div></section>`;
}

export const compareDefinition: SceneDefinition<CompareProps> = {
  type: "compare",
  fields: Object.keys(compareSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 3,
  revealSeconds: () => AFTER_DELAY_SECONDS + SIDE_FADE_SECONDS,
  holdSeconds(props) {
    const words = readingSeconds(`${props.before.text ?? ""} ${props.after.text ?? ""}`);
    const looking = [props.before, props.after].filter((side) => side.src !== undefined).length * 1.5;
    return AFTER_DELAY_SECONDS + SIDE_FADE_SECONDS + words + looking + 0.5;
  },
  summary(props) {
    const describe = (side: CompareSide): string => side.text ?? `image ${side.src ?? ""}`;
    return `${describe(props.before)} / ${describe(props.after)}`;
  },
  texts(props) {
    return SIDES.flatMap(({ key }): SceneText[] => {
      const side = props[key];
      const texts: SceneText[] = [];
      if (side.label) texts.push({ path: `${key}.label`, text: side.label, font: "mono" });
      if (side.text) texts.push({ path: `${key}.text`, text: side.text, font: "sans" });
      return texts;
    });
  },
  assets(props) {
    return SIDES.flatMap(({ key }) => {
      const src = props[key].src;
      return src === undefined ? [] : [{ path: `${key}.src`, src }];
    });
  },
  compile(props, ctx) {
    const sides = SIDES.map(({ key, fallback }, index) => sideHtml(props[key], key, fallback, index, ctx)).join("");
    return `${sceneChrome(ctx)}<div class="sf-compare">${sides}</div>`;
  },
  css: `
.sf-compare{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*9);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:calc(var(--sf-unit)*6)}
.sf-compare__side{min-width:0;min-height:0;display:flex;flex-direction:column}
.sf-compare__label{flex:none;height:calc(var(--sf-unit)*7);font:500 calc(var(--sf-unit)*3.4)/calc(var(--sf-unit)*4) var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-compare__side.is-after .sf-compare__label{color:var(--sf-accent)}
.sf-compare__body{flex:1;min-height:0;display:flex;align-items:flex-start;border-top:1px solid var(--sf-line)}
.sf-compare__text{padding-top:calc(var(--sf-unit)*3);font:800 calc(var(--sf-unit)*9)/1.05 var(--sf-font-sans);letter-spacing:-0.04em;color:var(--sf-text);text-wrap:balance}
.sf-compare__side.is-before .sf-compare__text{color:var(--sf-muted)}
.sf-compare__img,.sf-compare .sf-shot__missing{display:block;margin-top:-1px;background:var(--sf-surface)}
@media (max-aspect-ratio:1/1){.sf-compare{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr);row-gap:calc(var(--sf-unit)*6)}}
`,
};
```

`packages/scenes/src/compare/mount.ts`:

```ts
import { clamp01, easeOutCubic, fadeExit, reveal } from "../motion";
import type { SceneMount } from "../types";
import { AFTER_DELAY_SECONDS, RECEDED, SIDE_FADE_SECONDS } from "./timing";

export const mountCompare: SceneMount = (el, ctx) => {
  const [before, after] = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-side]"));
  const fade = SIDE_FADE_SECONDS * ctx.fps;
  const afterStart = ctx.enterFrames + AFTER_DELAY_SECONDS * ctx.fps;
  return {
    seek(frame) {
      fadeExit(el, ctx, frame);
      if (!before || !after) return;
      reveal(before, frame, 0, ctx.enterFrames);
      reveal(after, frame, afterStart, fade);
      // Once the after side is in, the before side steps back so the eye goes to what changed.
      const arrived = easeOutCubic(clamp01((frame - afterStart) / fade));
      before.style.opacity = String(Number(before.style.opacity) * (1 - arrived * (1 - RECEDED)));
    },
  };
};
```

Register it, keeping `terminal` last:

```text
FILE packages/scenes/src/index.ts
<<<<
import { bulletsSchema } from "./bullets/schema";
====
import { bulletsSchema } from "./bullets/schema";
import { compareDefinition } from "./compare/definition";
import { compareSchema } from "./compare/schema";
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  screenshotSchema,
  terminalSchema,
]);
====
  screenshotSchema,
  compareSchema,
  terminalSchema,
]);
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  screenshot: widen(screenshotDefinition),
  terminal: widen(terminalDefinition),
====
  screenshot: widen(screenshotDefinition),
  compare: widen(compareDefinition),
  terminal: widen(terminalDefinition),
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
import { mountCode } from "./code/mount";
====
import { mountCode } from "./code/mount";
import { mountCompare } from "./compare/mount";
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
  screenshot: mountScreenshot,
  terminal: mountTerminal,
====
  screenshot: mountScreenshot,
  compare: mountCompare,
  terminal: mountTerminal,
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean.

The conformance check "is fully visible on its last frame before the exit" reads `[data-sf-enter]` elements; the compare scene has none, and its before side is deliberately receded, so that check holds without change. If a comparison test reports sides overlapping or outside the frame, the constants at the top of `compare/definition.ts` do not match the CSS: make them agree.

- [ ] **Step 5: Examples, and look at them**

Add a comparison to `examples/launch.json`, after the `statement` scene:

```json
    {
      "type": "compare",
      "before": { "label": "Animation code", "text": "Forty lines a model cannot check." },
      "after": { "label": "A scenefile", "text": "Six lines it can." }
    },
```

Make a real image for the screenshot example from the tool's own output, then write the example:

```bash
pnpm build
node packages/cli/dist/main.js render examples/launch.json -o out/launch.mp4
mkdir -p examples/assets
ffmpeg -y -loglevel error -ss 16 -i out/launch.mp4 -frames:v 1 examples/assets/frame.png
```

`examples/screenshot.json`:

```json
{
  "version": 1,
  "scenes": [
    {
      "type": "screenshot",
      "src": "assets/frame.png",
      "caption": "A frame from the launch example, used here as an image.",
      "callouts": [
        { "x": 0.06, "y": 0.07, "label": "Scene counter" },
        { "x": 0.5, "y": 0.55, "label": "Marked lines stay bright" }
      ]
    },
    {
      "type": "compare",
      "before": { "label": "The image", "src": "assets/frame.png" },
      "after": { "label": "What it shows", "text": "Code with two lines marked." }
    }
  ]
}
```

Run:

```bash
node packages/cli/dist/main.js check examples/screenshot.json
node packages/cli/dist/main.js render examples/screenshot.json -o out/screenshot.mp4
```

Render `examples/screenshot.json` in portrait and square as well (copy it with `"format"` set), extract a late frame from every scene, and look. Fix scene CSS and re-render until all hold:

- The image is whole, sharp, and has a hairline border; nothing covers the scene counter.
- Callout dots sit where their fractions say; labels are readable and inside the image.
- The caption sits clear below the image.
- In a comparison the two sides are plainly separate, the after side is the brighter one, and its label is the only lime.
- Portrait: the two sides stack, each using the full width.
- If the callout positions in the example do not land on what their labels name, change the positions; the example must be true.

- [ ] **Step 6: Update the README**

```text
FILE README.md
<<<<
**Status: early development.** Eight scene types (`title`, `statement`, `quote`,
`bullets`, `stat`, `code`, `outro`, `terminal`) and two themes
====
**Status: early development.** Ten scene types (`title`, `statement`, `quote`,
`bullets`, `stat`, `code`, `screenshot`, `compare`, `outro`, `terminal`) and two themes
>>>>
```

```text
FILE README.md
<<<<
  fix: "type" must be one of: title, statement, quote, bullets, stat, code, outro, terminal.
====
  fix: "type" must be one of: title, statement, quote, bullets, stat, code, outro, screenshot, compare, terminal.
>>>>
```

- [ ] **Step 7: Run everything once more and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS and clean.

```bash
git add -A
git commit -m "feat(scenes): compare scene, and examples that use images"
```

---

## What Plan 2b-2 leaves for later

| Item | Plan |
|---|---|
| `custom` scene: sanitized HTML and CSS, externally driven CSS animations | 2b-3 |
| Asset cache | 3, with the MCP server |
| SVG images | 2b-3 |
| Aliases and suggestions for nested fields (`steps`, `callouts`, compare sides) | 2b-3 |
| Everything listed under 2c in Plan 2a | 2c |
