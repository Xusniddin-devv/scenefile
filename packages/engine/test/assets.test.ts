import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AssetSources,
  type HttpResponse,
  MAX_ASSET_BYTES,
  type ResolvedAddress,
  imageInfo,
  isPrivateAddress,
  loadAssets,
} from "../src/assets";

function png(width: number, height: number, extraChunk?: string): Buffer {
  const header = Buffer.alloc(33);
  header.writeUInt32BE(0x89504e47, 0);
  header.writeUInt32BE(0x0d0a1a0a, 4);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  const chunk = (type: string): Buffer => {
    const data = Buffer.alloc(12);
    data.write(type, 4, "latin1");
    return data;
  };
  return Buffer.concat([header, ...(extraChunk ? [chunk(extraChunk)] : []), chunk("IDAT"), chunk("IEND")]);
}

function jpeg(width: number, height: number, orientation?: number): Buffer {
  const segments = [Buffer.from([0xff, 0xd8])];
  if (orientation !== undefined) {
    // APP1 holding EXIF: a little-endian TIFF with one entry, Orientation.
    const tiff = Buffer.alloc(26);
    tiff.write("II", 0, "latin1");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(orientation, 18);
    const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const head = Buffer.alloc(4);
    head.writeUInt16BE(0xffe1, 0);
    head.writeUInt16BE(body.length + 2, 2);
    segments.push(head, body);
  }
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc2, 0);
  sof.writeUInt16BE(9, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  segments.push(sof, Buffer.alloc(8));
  return Buffer.concat(segments);
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

  it("reports a rotated photo by the shape it is drawn in, not the shape it is stored in", () => {
    expect(imageInfo(jpeg(1600, 900, 1))).toMatchObject({ width: 1600, height: 900 });
    expect(imageInfo(jpeg(1600, 900, 3))).toMatchObject({ width: 1600, height: 900 });
    for (const sideways of [5, 6, 7, 8]) expect(imageInfo(jpeg(1600, 900, sideways))).toMatchObject({ width: 900, height: 1600 });
  });

  it("rejects what it cannot show as a still image", () => {
    expect(imageInfo(webp(640, 480, true))).toBeNull();
    expect(imageInfo(png(100, 100, "acTL"))).toBeNull();
    expect(imageInfo(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBeNull();
    expect(imageInfo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageInfo(Buffer.from("not an image at all"))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
    expect(imageInfo(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("rejects damaged headers rather than passing them to the browser", () => {
    expect(imageInfo(png(0, 100))).toBeNull();
    expect(imageInfo(png(100, 0))).toBeNull();
    expect(imageInfo(jpeg(0, 0))).toBeNull();
    const noHeaderChunk = png(100, 100);
    noHeaderChunk.write("JUNK", 12, "latin1");
    expect(imageInfo(noHeaderChunk)).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "127.8.8.8", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "0.1.2.3", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "treats %s as public",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe("loading local images", () => {
  let root: string;
  let baseDir: string;
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "scenefile-assets-")));
    baseDir = join(root, "project");
    mkdirSync(join(baseDir, "img"), { recursive: true });
    mkdirSync(join(root, "outside"));
    writeFileSync(join(baseDir, "shot.png"), png(1280, 720));
    writeFileSync(join(baseDir, "img", "photo.jpg"), jpeg(800, 600));
    writeFileSync(join(baseDir, "..dots.png"), png(10, 10));
    writeFileSync(join(baseDir, "shot:final.png"), png(20, 20));
    writeFileSync(join(baseDir, "notes.txt"), "hello");
    writeFileSync(join(baseDir, "moving.png"), png(100, 100, "acTL"));
    writeFileSync(join(baseDir, "bomb.png"), png(20000, 20000));
    writeFileSync(join(baseDir, "huge.png"), png(10, 10));
    truncateSync(join(baseDir, "huge.png"), MAX_ASSET_BYTES + 1);
    writeFileSync(join(root, "outside", "secret.png"), png(64, 64));
    symlinkSync(join(root, "outside", "secret.png"), join(baseDir, "link.png"));
    symlinkSync(join(root, "outside"), join(baseDir, "linkdir"));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const load = (src: string, path = "scenes[0].src") => loadAssets([{ path, src }], { baseDir });

  it("loads an image from the scenefile's folder, with its size and a data URI", async () => {
    const { assets, diagnostics } = await load("shot.png");
    expect(diagnostics).toEqual([]);
    expect(assets.get("shot.png")).toMatchObject({ mime: "image/png", width: 1280, height: 720 });
    expect(assets.get("shot.png")?.dataUri.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
    expect((await load("img/photo.jpg")).assets.get("img/photo.jpg")).toMatchObject({ width: 800, height: 600 });
    expect((await load("./img/../shot.png")).diagnostics).toEqual([]);
  });

  it("accepts file names that merely look like something else", async () => {
    expect((await load("..dots.png")).diagnostics).toEqual([]);
    expect((await load("shot:final.png")).diagnostics).toEqual([]);
  });

  it("loads one image once however many scenes use it, each with a distinct id", async () => {
    const { assets, diagnostics } = await loadAssets(
      [
        { path: "scenes[0].src", src: "shot.png" },
        { path: "scenes[3].before.src", src: "shot.png" },
        { path: "scenes[4].src", src: "img/photo.jpg" },
      ],
      { baseDir },
    );
    expect(diagnostics).toEqual([]);
    expect(assets.size).toBe(2);
    expect(new Set([...assets.values()].map((asset) => asset.id)).size).toBe(2);
  });

  it.each(["../outside/secret.png", "img/../../outside/secret.png", "link.png", "linkdir/secret.png"])(
    "refuses %s, which is or leads outside the scenefile's folder",
    async (src) => {
      const { assets, diagnostics } = await load(src);
      expect(assets.size).toBe(0);
      expect(diagnostics).toEqual([
        expect.objectContaining({ code: "ASSET_NOT_FOUND", severity: "error", path: "scenes[0].src" }),
      ]);
      expect(diagnostics[0]?.message).toContain("outside");
    },
  );

  it("refuses an absolute path even to a file that exists", async () => {
    const { assets, diagnostics } = await load(join(root, "outside", "secret.png"));
    expect(assets.size).toBe(0);
    expect(diagnostics[0]?.message).toContain("outside");
  });

  it("does not read local files when the scenefile sits in the filesystem root", async () => {
    const { assets, diagnostics } = await loadAssets([{ path: "scenes[0].src", src: "etc/hosts" }], { baseDir: "/" });
    expect(assets.size).toBe(0);
    expect(diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND" });
  });

  it("reports a missing file at every place it is used, and a folder as not a file", async () => {
    const { diagnostics } = await loadAssets(
      [{ path: "scenes[0].src", src: "nope.png" }, { path: "scenes[2].after.src", src: "nope.png" }],
      { baseDir },
    );
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["ASSET_NOT_FOUND", "scenes[0].src"],
      ["ASSET_NOT_FOUND", "scenes[2].after.src"],
    ]);
    expect(diagnostics[0]?.message).toContain("nope.png");
    expect((await load("img")).diagnostics[0]?.message).toMatch(/folder|not a file/);
  });

  it("refuses files that are not still images, are too large in bytes, or too large in pixels", async () => {
    expect((await load("notes.txt")).diagnostics[0]).toMatchObject({ code: "ASSET_UNSUPPORTED" });
    expect((await load("moving.png")).diagnostics[0]).toMatchObject({ code: "ASSET_UNSUPPORTED" });
    expect((await load("huge.png")).diagnostics[0]).toMatchObject({ code: "ASSET_TOO_LARGE" });
    const bomb = (await load("bomb.png")).diagnostics[0];
    expect(bomb).toMatchObject({ code: "ASSET_TOO_LARGE" });
    expect(bomb?.message).toContain("20000x20000");
  });
});

describe("downloading images", () => {
  const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };
  const hosts: Record<string, ResolvedAddress[]> = {
    "example.com": [PUBLIC],
    "cdn.example.com": [PUBLIC],
    "rebind.example.com": [PUBLIC, { address: "169.254.169.254", family: 4 }],
    "inner.example.com": [{ address: "10.0.0.7", family: 4 }],
    "v6.example.com": [{ address: "fd00::1", family: 6 }],
  };

  interface Route {
    status?: number;
    headers?: Record<string, string>;
    chunks?: Uint8Array[];
    endless?: boolean;
  }

  function network(routes: Record<string, Route>) {
    const looked: string[] = [];
    const requested: { url: string; address: string }[] = [];
    let closed = 0;
    let produced = 0;
    const sources: AssetSources = {
      baseDir: "/nowhere",
      lookup: async (hostname) => {
        looked.push(hostname);
        const found = hosts[hostname];
        if (!found) throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
        return found;
      },
      request: async (url, address): Promise<HttpResponse> => {
        requested.push({ url: url.href, address: address.address });
        const route = routes[url.href];
        if (!route) throw new Error("connect ECONNREFUSED");
        async function* body(): AsyncGenerator<Uint8Array> {
          for (const chunk of route?.chunks ?? []) {
            produced += chunk.byteLength;
            yield chunk;
          }
          while (route?.endless) {
            produced += 1024 * 1024;
            yield new Uint8Array(1024 * 1024);
          }
        }
        return { status: route.status ?? 200, headers: route.headers ?? {}, body: body(), close: () => void closed++ };
      },
    };
    return { sources, looked, requested, closedCount: () => closed, producedBytes: () => produced };
  }

  const load = (net: ReturnType<typeof network>, src: string) =>
    loadAssets([{ path: "scenes[0].src", src }], net.sources);

  it("downloads an https image, connecting to the address it checked", async () => {
    const net = network({ "https://example.com/a.png": { chunks: [png(640, 360)] } });
    const { assets, diagnostics } = await load(net, "https://example.com/a.png");
    expect(diagnostics).toEqual([]);
    expect(assets.get("https://example.com/a.png")).toMatchObject({ width: 640, height: 360 });
    expect(net.requested).toEqual([{ url: "https://example.com/a.png", address: "93.184.216.34" }]);
  });

  it.each([
    "http://example.com/a.png",
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "https://localhost/a.png",
    "https://localhost./a.png",
    "https://app.localhost/a.png",
    "https://printer.local/a.png",
    "https://metadata.google.internal./a.png",
    "https://router/a.png",
    "https://127.0.0.1/a.png",
    "https://2130706433/a.png",
    "https://0x7f.1/a.png",
    "https://10.0.0.5/a.png",
    "https://192.168.1.1/a.png",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/a.png",
    "https://[::1]/a.png",
    "https://[::ffff:127.0.0.1]/a.png",
    "https://example.com@127.0.0.1/a.png",
  ])("refuses %s without looking it up or making a request", async (src) => {
    const net = network({});
    const { assets, diagnostics } = await load(net, src);
    expect(net.requested).toEqual([]);
    expect(net.looked).toEqual([]);
    expect(assets.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "ASSET_NOT_FOUND", path: "scenes[0].src" })]);
  });

  it.each(["https://inner.example.com/a.png", "https://v6.example.com/a.png", "https://rebind.example.com/a.png"])(
    "refuses %s, a public-looking name that resolves to a private address, without making a request",
    async (src) => {
      const net = network({ [src]: { chunks: [png(1, 1)] } });
      const { diagnostics } = await load(net, src);
      expect(net.looked).toHaveLength(1);
      expect(net.requested).toEqual([]);
      expect(diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND" });
      expect(diagnostics[0]?.message).toMatch(/private/);
    },
  );

  it("can be told not to download at all, and then refuses before looking anything up", async () => {
    const net = network({ "https://example.com/a.png": { chunks: [png(640, 360)] } });
    const { assets, diagnostics } = await loadAssets([{ path: "scenes[0].src", src: "https://example.com/a.png" }], {
      ...net.sources,
      allowRemote: false,
    });
    expect(assets.size).toBe(0);
    expect(net.looked).toEqual([]);
    expect(net.requested).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND", path: "scenes[0].src" });
    expect(diagnostics[0]?.message).toMatch(/turned off/);
    expect(diagnostics[0]?.fix).toMatch(/folder/);
  });

  it("follows a redirect to another public https address, checking it first", async () => {
    const net = network({
      "https://example.com/a.png": { status: 302, headers: { location: "https://cdn.example.com/real.png" } },
      "https://cdn.example.com/real.png": { chunks: [png(320, 200)] },
    });
    const { assets, diagnostics } = await load(net, "https://example.com/a.png");
    expect(diagnostics).toEqual([]);
    expect(assets.get("https://example.com/a.png")).toMatchObject({ width: 320, height: 200 });
    expect(net.looked).toEqual(["example.com", "cdn.example.com"]);
    expect(net.closedCount()).toBe(1);
  });

  it.each([
    "http://127.0.0.1:8080/internal/secret.png",
    "http://example.com/a.png",
    "https://169.254.169.254/latest/meta-data",
    "https://inner.example.com/a.png",
    "/relative-is-fine-but-file-is-not",
  ])("does not follow a redirect to %s unless it passes the same checks", async (location) => {
    const net = network({
      "https://example.com/a.png": { status: 302, headers: { location } },
      "https://example.com/relative-is-fine-but-file-is-not": { status: 404 },
    });
    const { assets, diagnostics } = await load(net, "https://example.com/a.png");
    expect(assets.size).toBe(0);
    expect(diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND" });
    for (const request of net.requested) {
      expect(request.url.startsWith("https://example.com/")).toBe(true);
      expect(request.address).toBe("93.184.216.34");
    }
  });

  it("gives up after a few redirects", async () => {
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 10; i++) {
      routes[`https://example.com/${i}`] = { status: 301, headers: { location: `https://example.com/${i + 1}` } };
    }
    const net = network(routes);
    const { diagnostics } = await load(net, "https://example.com/0");
    expect(diagnostics[0]?.message).toMatch(/redirect/);
    expect(net.requested.length).toBeLessThanOrEqual(4);
  });

  it("stops reading as soon as a download passes the size limit, however long the server keeps sending", async () => {
    const net = network({ "https://example.com/big.png": { chunks: [png(10, 10)], endless: true } });
    const { diagnostics } = await load(net, "https://example.com/big.png");
    expect(diagnostics[0]).toMatchObject({ code: "ASSET_TOO_LARGE" });
    expect(net.producedBytes()).toBeLessThan(MAX_ASSET_BYTES + 3 * 1024 * 1024);
    expect(net.closedCount()).toBe(1);
  });

  it("refuses a declared size over the limit, and compressed bodies it could not bound", async () => {
    const declared = network({
      "https://example.com/a.png": { headers: { "content-length": String(MAX_ASSET_BYTES + 1) }, chunks: [png(1, 1)] },
    });
    expect((await load(declared, "https://example.com/a.png")).diagnostics[0]).toMatchObject({ code: "ASSET_TOO_LARGE" });
    expect(declared.producedBytes()).toBe(0);
    const gzip = network({ "https://example.com/a.png": { headers: { "content-encoding": "gzip" }, chunks: [png(1, 1)] } });
    expect((await load(gzip, "https://example.com/a.png")).diagnostics[0]).toMatchObject({ code: "ASSET_NOT_FOUND" });
    expect(gzip.producedBytes()).toBe(0);
  });

  it("reports the server's answer, an unknown name, and a refused connection, with the underlying reason", async () => {
    const net = network({ "https://example.com/missing.png": { status: 404 } });
    expect((await load(net, "https://example.com/missing.png")).diagnostics[0]?.message).toContain("404");
    expect((await load(net, "https://nowhere.invalid/a.png")).diagnostics[0]?.message).toContain("ENOTFOUND");
    expect((await load(net, "https://example.com/down.png")).diagnostics[0]?.message).toContain("ECONNREFUSED");
  });

  it("stops downloading when the whole command has run out of time", async () => {
    let now = 0;
    const net = network({
      "https://example.com/1.png": { chunks: [png(1, 1)] },
      "https://example.com/2.png": { chunks: [png(2, 2)] },
    });
    const sources: AssetSources = {
      ...net.sources,
      now: () => {
        now += 40_000;
        return now;
      },
    };
    const { diagnostics } = await loadAssets(
      [{ path: "scenes[0].src", src: "https://example.com/1.png" }, { path: "scenes[1].src", src: "https://example.com/2.png" }],
      sources,
    );
    expect(diagnostics.at(-1)).toMatchObject({ code: "ASSET_NOT_FOUND", path: "scenes[1].src" });
    expect(diagnostics.at(-1)?.message).toMatch(/too long|time/);
  });
});

describe("the total of all images", () => {
  it("is limited across a scenefile", async () => {
    const big = Buffer.concat([png(100, 100), Buffer.alloc(7 * 1024 * 1024)]);
    const routes = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`https://example.com/${i}.png`, { chunks: [big] }]),
    );
    const sources: AssetSources = {
      baseDir: "/nowhere",
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url) => ({
        status: 200,
        headers: {},
        body: (async function* () {
          yield* routes[url.href]?.chunks ?? [];
        })(),
        close: () => undefined,
      }),
    };
    const { assets, diagnostics } = await loadAssets(
      Array.from({ length: 6 }, (_, i) => ({ path: `scenes[${i}].src`, src: `https://example.com/${i}.png` })),
      sources,
    );
    expect(assets.size).toBe(4);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["ASSET_TOO_LARGE", "scenes[4].src"],
      ["ASSET_TOO_LARGE", "scenes[5].src"],
    ]);
    expect(diagnostics[0]?.message).toMatch(/together/);
  });
});
