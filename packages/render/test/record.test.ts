import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSteps, probeVideo, recordPage } from "../src/index";

let dir: string;
let server: Server;
let base: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-record-"));
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    const head = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:20px sans-serif;background:#fff}</style>';
    if (request.url === "/wide") return response.end(`${head}<div style="padding:200px 360px"><input id="wide" style="width:560px;height:60px;background:#06f;border:0;color:#fff;font-size:20px"></div>`);
    if (request.url === "/links") return response.end(`${head}<a href="/slow" style="display:block;margin:80px">Go on</a>`);
    if (request.url === "/slow") {
      // A page that keeps the browser waiting, then sends it on by script while frames are being taken.
      return void setTimeout(() => response.end(`${head}<a href="#" style="display:block;margin:80px" onclick="setTimeout(()=>location.href='/next',30);return false">Slowly on</a>`), 300);
    }
    if (request.url === "/next") return response.end(`${head}<h1 style="margin:40px">The second page</h1>`);
    response.end(`${head}<div style="padding:60px">
      <input id="email" style="font-size:20px;width:300px">
      <button id="go" style="font-size:20px;background:#d00;color:#fff;border:0;padding:12px 24px"
        onclick="document.body.style.background='#0a0'">Sign in</button>
      <div style="height:2000px"></div><p id="far">Far down</p></div>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The average color of a whole frame, as [red, green, blue]. */
function average(file: string, frame: number): number[] {
  const { stdout } = spawnSync("ffmpeg", ["-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${frame}),scale=1:1:flags=area`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...stdout.subarray(0, 3)];
}
/** How much of a frame is the red of the button. */
function redShare(file: string, frame: number): number {
  const { stdout } = spawnSync("ffmpeg", ["-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${frame}),scale=192:108`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  let red = 0;
  for (let i = 0; i + 2 < stdout.length; i += 3) if ((stdout[i] ?? 0) > 170 && (stdout[i + 1] ?? 0) < 60 && (stdout[i + 2] ?? 0) < 60) red += 1;
  return red / (stdout.length / 3);
}

describe("reading the steps of a walkthrough", () => {
  it("accepts the steps people write, and says what is wrong with one that is not", () => {
    expect(parseSteps([{ type: "ada@example.com", into: "#email" }, { click: "text=Sign in" }, { press: "Enter" }, { scroll: 600 }, { wait: 1 }, { goto: "/next" }, { hover: "#go" }])).toHaveLength(7);
    expect(parseSteps({ steps: [{ click: "#go" }] })).toHaveLength(1);
    expect(() => parseSteps([{ click: "#go" }, { tap: "#go" }])).toThrow(/Step 2/);
    expect(() => parseSteps([{ type: "hello" }])).toThrow(/into/);
    expect(() => parseSteps([{ wait: 99 }])).toThrow(/Step 1/);
    expect(() => parseSteps([])).toThrow(/at least one/);
  });
});

describe("recording a walkthrough of a page", () => {
  it("types, clicks and shows the result, moving closer to what is being used", async () => {
    const output = join(dir, "walk.mp4");
    const steps = parseSteps([{ type: "ada@example.com", into: "#email" }, { click: "#go" }, { wait: 1 }]);
    const recorded = await recordPage({ url: `${base}/`, output, steps });
    const probed = await probeVideo(output);
    expect([probed.width, probed.height, probed.fps]).toEqual([1920, 1080, 30]);
    expect(probed.frames).toBe(recorded.frames);
    expect(recorded.seconds).toBeGreaterThan(3);
    expect(recorded.seconds).toBe(Math.round((recorded.frames / 30) * 100) / 100);
    // It opens on the whole page, white, before anything is done.
    const [r = 0, g = 0, b = 0] = average(output, 0);
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
    // While the button is clicked the view is closer, so the button fills more of the frame.
    const press = recorded.marks.find((mark) => mark.step === 1)?.frame ?? 0;
    expect(redShare(output, press)).toBeGreaterThan(redShare(output, 0) * 1.6);
    // And the click did what it does: the page turned green.
    const [lr = 0, lg = 0] = average(output, recorded.frames - 1);
    expect(lg).toBeGreaterThan(lr + 60);
  });

  it("moves in on a wide field too, so what is typed can be read", async () => {
    const output = join(dir, "wide.mp4");
    const recorded = await recordPage({ url: `${base}/wide`, output, steps: parseSteps([{ type: "hello", into: "#wide" }]) });
    // Unmoved, the 560x60 field is 3.6% of the frame. Moved in on, it is over two and a half times that.
    const typing = (recorded.marks[0]?.frame ?? 0) + 12;
    const { stdout } = spawnSync("ffmpeg", ["-loglevel", "error", "-i", output, "-vf", `select=eq(n\\,${typing}),scale=192:108`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    let blue = 0;
    for (let i = 0; i + 2 < stdout.length; i += 3) if ((stdout[i + 2] ?? 0) > 170 && (stdout[i] ?? 0) < 90) blue += 1;
    expect(blue / (stdout.length / 3)).toBeGreaterThan(0.09);
  });

  it("scrolls, goes to another page, and records a phone's view", async () => {
    const output = join(dir, "phone.mp4");
    const recorded = await recordPage({ url: `${base}/`, output, device: "phone", steps: parseSteps([{ scroll: 1200 }, { goto: "/next" }]) });
    const probed = await probeVideo(output);
    expect(probed.width).toBe(1080);
    expect(probed.height).toBeGreaterThan(2000);
    expect(probed.frames).toBe(recorded.frames);
  });

  it("follows a link that is clicked to the page it opens", async () => {
    const output = join(dir, "link.mp4");
    const recorded = await recordPage({ url: `${base}/links`, output, steps: parseSteps([{ click: "text=Go on" }, { click: "text=Slowly on" }]) });
    expect(recorded.url).toBe(`${base}/next`);
    expect((await probeVideo(output)).frames).toBe(recorded.frames);
  });

  it("names the step that could not be done, and leaves no file", async () => {
    const output = join(dir, "broken.mp4");
    const attempt = recordPage({ url: `${base}/`, output, steps: parseSteps([{ click: "#go" }, { click: "#nothing-like-this" }]), stepTimeoutSeconds: 2 });
    await expect(attempt).rejects.toThrow(/Step 2 .*#nothing-like-this/);
    expect(spawnSync("ls", [output]).status).not.toBe(0);
  });

  it("only opens web addresses", async () => {
    await expect(recordPage({ url: "file:///etc/hosts", output: join(dir, "x.mp4"), steps: parseSteps([{ wait: 1 }]) })).rejects.toThrow(/http/);
    await expect(recordPage({ url: `${base}/`, output: join(dir, "x.png"), steps: parseSteps([{ wait: 1 }]) })).rejects.toThrow(/\.mp4/);
  });
});
