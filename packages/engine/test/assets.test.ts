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
