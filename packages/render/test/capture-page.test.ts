import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    response.end(
      `<body style="margin:0;background:#fff"><h1 id="w"></h1><div style="height:3000px"></div>
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
    // A phone-like page lays out a fraction of a pixel short, so the height may be one less.
    const [width, height] = size(phone.output);
    expect(width).toBe(1170);
    expect(Math.abs(height - 2532)).toBeLessThanOrEqual(1);
    expect([phone.width, phone.height]).toEqual([width, height]);
  });

  it("can take the whole page, up to a limit, and ask for the page's dark look", async () => {
    const whole = await capturePage({ url: `${base}/`, output: join(dir, "full.png"), device: "phone", fullPage: true, dark: true });
    expect(whole.height).toBeGreaterThan(2532);
    expect(whole.height).toBeLessThanOrEqual(8000);
  });

  it("refuses anything that is not a web address, and says so when a page does not load", async () => {
    await expect(capturePage({ url: "file:///etc/hosts", output: join(dir, "x.png") })).rejects.toThrow(/http/);
    await expect(capturePage({ url: "not a url", output: join(dir, "x.png") })).rejects.toThrow(/address/);
    const slow = capturePage({ url: `${base}/slow`, output: join(dir, "slow.png"), timeoutSeconds: 2 });
    await expect(slow).rejects.toBeInstanceOf(EnvironmentError);
    await expect(capturePage({ url: `${base}/`, output: join(dir, "x.jpg") })).rejects.toThrow(/\.png/);
  });
});

describe("a phone around a screenshot", () => {
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
