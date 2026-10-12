import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "@scenefile/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EnvironmentError, captureFrame, capturePage, openComposition } from "../src/index";

let dir: string;
let server: Server;
let base: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-capture-"));
  server = createServer((request, response) => {
    if (request.url === "/slow") return; // never answers
    response.setHeader("content-type", "text/html");
    const head = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    if (request.url === "/missing") {
      response.statusCode = 404;
      return response.end(`${head}<h1>Not here</h1>`);
    }
    if (request.url === "/busy") {
      // Loads, then never lets the page answer another question.
      return response.end(`${head}<body><script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 50))</script></body>`);
    }
    if (request.url === "/hero") {
      return response.end(`${head}<title>Hero page</title><body style="margin:0"><div style="height:100vh;background:#06c"></div><div style="height:1000px;background:#fc0"></div></body>`);
    }
    if (request.url === "/noise") {
      // A picture that does not compress: every pixel random.
      return response.end(
        `${head}<body style="margin:0"><canvas id="c"></canvas><script>const c=document.getElementById("c");c.width=innerWidth*devicePixelRatio;c.height=innerHeight*devicePixelRatio;c.style.width="100vw";c.style.height="100vh";const x=c.getContext("2d");const d=x.createImageData(c.width,c.height);for(let i=0;i<d.data.length;i++)d.data[i]=Math.random()*255;x.putImageData(d,0,0)</script></body>`,
      );
    }
    response.end(
      `${head}<title>Home</title><body style="margin:0;background:#fff"><h1 id="w"></h1><div style="height:3000px"></div>
       <script>document.getElementById("w").textContent = innerWidth + (matchMedia("(prefers-color-scheme: dark)").matches ? " dark" : " light")</script></body>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Width and height from a PNG's header. */
function size(file: string): [number, number] {
  const png = readFileSync(file);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("capturing a web page", () => {
  it("takes a sharp picture at desktop size, and at a phone's", async () => {
    const desktop = await capturePage({ url: `${base}/`, output: join(dir, "desktop.png") });
    expect(size(desktop.output)).toEqual([2560, 1600]);
    expect(desktop).toMatchObject({ width: 2560, height: 1600, device: "desktop" });
    const phone = await capturePage({ url: `${base}/`, output: join(dir, "phone.png"), device: "phone" });
    expect(size(phone.output)).toEqual([1170, 2532]);
    expect(phone).toMatchObject({ width: 1170, height: 2532, title: "Home", url: `${base}/` });
  });

  it("can take the whole page, up to a limit, and ask for the page's dark look", async () => {
    // A tall first screen stays one screen tall; the rest of the page follows it.
    const whole = await capturePage({ url: `${base}/hero`, output: join(dir, "full.png"), device: "phone", fullPage: true });
    expect([whole.width, whole.height]).toEqual([1170, (844 + 1000) * 3]);
    const long = await capturePage({ url: `${base}/`, output: join(dir, "long.png"), device: "phone", fullPage: true });
    expect(long.height).toBeLessThanOrEqual(8000);
    expect(long.height).toBeGreaterThan(7000);
  });

  it("refuses anything that is not a web address, and says so when a page does not load", async () => {
    await expect(capturePage({ url: "file:///etc/hosts", output: join(dir, "x.png") })).rejects.toThrow(/http/);
    await expect(capturePage({ url: "not a url", output: join(dir, "x.png") })).rejects.toThrow(/address/);
    const slow = capturePage({ url: `${base}/slow`, output: join(dir, "slow.png"), timeoutSeconds: 2 });
    await expect(slow).rejects.toBeInstanceOf(EnvironmentError);
    await expect(capturePage({ url: `${base}/`, output: join(dir, "x.jpg") })).rejects.toThrow(/\.png/);
    await expect(capturePage({ url: "localhost:3000", output: join(dir, "x.png") })).rejects.toThrow("http://localhost:3000");
  });

  it("says what went wrong in plain words, quickly", async () => {
    const started = Date.now();
    // A port that was just in use and is now closed: nothing is listening there.
    const gone = createServer();
    await new Promise<void>((resolve) => gone.listen(0, "127.0.0.1", resolve));
    const closed = (gone.address() as { port: number }).port;
    await new Promise((resolve) => gone.close(resolve));
    const refused = await capturePage({ url: `http://127.0.0.1:${closed}/`, output: join(dir, "r.png") }).catch((cause: Error) => cause);
    expect(String(refused)).toMatch(/[Nn]othing is answering/);
    expect(String(refused)).not.toMatch(/\u001b|Call log|did not load within/);
    expect(Date.now() - started).toBeLessThan(15_000);
    const missing = await capturePage({ url: `${base}/missing`, output: join(dir, "m.png") }).catch((cause: Error) => cause);
    expect(String(missing)).toContain("404");
    expect(existsSync(join(dir, "m.png"))).toBe(false);
    mkdirSync(join(dir, "folder.png"));
    await expect(capturePage({ url: `${base}/`, output: join(dir, "folder.png") })).rejects.toThrow(/folder/);
  });

  it("gives up on a page that never settles, and leaves nothing running or half written", async () => {
    const started = Date.now();
    const stuck = capturePage({ url: `${base}/busy`, output: join(dir, "busy.png"), fullPage: true, deadlineSeconds: 6 });
    await expect(stuck).rejects.toBeInstanceOf(EnvironmentError);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(readdirSync(dir).filter((name) => name.startsWith("busy"))).toEqual([]);
  });

  it("never saves a picture too large to use: it takes a smaller one instead", async () => {
    const shot = await capturePage({ url: `${base}/noise`, output: join(dir, "noise.png") });
    expect(statSync(shot.output).size).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect([shot.width, shot.height]).toEqual([1280, 800]);
  });

  it("can be told to keep away from addresses that only this machine's network should reach", async () => {
    const refused = capturePage({ url: "http://169.254.169.254/latest/meta-data/", output: join(dir, "meta.png"), refuseLinkLocal: true });
    await expect(refused).rejects.toThrow(/link-local/);
  });
});

describe("a phone around a screenshot", () => {
  it("crops a whole-page capture to one screen, from the top, instead of drawing a sliver", async () => {
    const shot = await capturePage({ url: `${base}/`, output: join(dir, "tall.png"), device: "phone", fullPage: true });
    const png = readFileSync(shot.output);
    const asset = { id: "t1", src: "tall.png", width: shot.width, height: shot.height, dataUri: `data:image/png;base64,${png.toString("base64")}` };
    const result = check(
      { version: 1, scenes: [{ type: "screenshot", src: "tall.png", device: "phone" }, { type: "title", heading: "End" }] },
      { assets: new Map([["tall.png", asset as never]]), diagnostics: [] },
    );
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const session = await openComposition(result.composition);
    try {
      await captureFrame(session.page, 60);
      const view = await session.page.evaluate(() => {
        const box = document.querySelector(".sf-shot__view")?.getBoundingClientRect();
        const image = document.querySelector<HTMLElement>(".sf-shot__img");
        return { ratio: (box?.width ?? 0) / (box?.height ?? 1), fit: image ? getComputedStyle(image).objectFit : "", at: image ? getComputedStyle(image).objectPosition : "" };
      });
      expect(view.ratio).toBeGreaterThan(0.44);
      expect(view.ratio).toBeLessThan(0.48);
      expect(view.fit).toBe("cover");
      expect(view.at).toMatch(/^50% 0/);
    } finally {
      await session.close();
    }
  });

  it.each(["landscape-1080p", "portrait-1080p"])("%s: the picture keeps its shape inside the phone, and everything stays in the frame", async (format) => {
    const shot = await capturePage({ url: `${base}/`, output: join(dir, "app.png"), device: "phone" });
    const png = readFileSync(shot.output);
    const asset = { id: "a1", src: "app.png", width: shot.width, height: shot.height, dataUri: `data:image/png;base64,${png.toString("base64")}` };
    const result = check(
      { version: 1, format, scenes: [{ type: "screenshot", src: "app.png", device: "phone", caption: "Sign in with one tap." }, { type: "title", heading: "End" }] },
      { assets: new Map([["app.png", asset as never]]), diagnostics: [] },
    );
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const session = await openComposition(result.composition);
    try {
      await captureFrame(session.page, 60);
      const seen = await session.page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
        const image = box(".sf-shot__img");
        const phone = box(".sf-shot__frame");
        const caption = box(".sf-shot__caption");
        return {
          ratio: (image?.width ?? 0) / (image?.height ?? 1),
          imageInside: !!image && !!phone && image.left > phone.left && image.right < phone.right && image.top > phone.top && image.bottom < phone.bottom,
          phone: phone ? [phone.left, phone.top, phone.right, phone.bottom] : [],
          captionClear: !!caption && !!phone && (caption.left >= phone.right || caption.top >= phone.bottom),
          captionRight: caption?.right ?? 0,
          radius: getComputedStyle(document.querySelector(".sf-shot__frame") as Element).borderTopLeftRadius,
          frame: [innerWidth, innerHeight],
        };
      });
      expect(seen.ratio).toBeCloseTo(1170 / 2532, 2);
      expect(seen.imageInside).toBe(true);
      expect(seen.captionClear).toBe(true);
      expect(Number.parseFloat(seen.radius)).toBeGreaterThan(20);
      const [left, top, right, bottom] = seen.phone as [number, number, number, number];
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThan(80);
      expect(right).toBeLessThanOrEqual(seen.frame[0] ?? 0);
      expect(bottom).toBeLessThanOrEqual(seen.frame[1] ?? 0);
      expect(seen.captionRight).toBeLessThanOrEqual(seen.frame[0] ?? 0);
      // The phone is worth looking at: it uses most of the height there is.
      expect(bottom - top).toBeGreaterThan((seen.frame[1] ?? 0) * 0.55);
    } finally {
      await session.close();
    }
  });
});
