import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EnvironmentError, type RenderOptions, type RenderReport } from "@scenefile/render";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ServerOptions, createServer } from "../src/index";

const asset = fileURLToPath(new URL("../../scenes/test/assets/shot.png", import.meta.url));
const valid = {
  version: 1,
  scenes: [
    { type: "title", heading: "Ship faster", sub: "one two three four" },
    { type: "terminal", steps: [{ run: "npx x" }] },
  ],
};

let outer: string;
let root: string;
beforeAll(() => {
  outer = realpathSync(mkdtempSync(join(tmpdir(), "scenefile-mcp-")));
  root = join(outer, "project");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(join(outer, "outside"));
  copyFileSync(asset, join(root, "shot.png"));
  writeFileSync(join(root, "video.json"), JSON.stringify(valid));
  writeFileSync(join(root, "sub", "nested.json"), JSON.stringify({ ...valid, scenes: [{ type: "screenshot", src: "../shot.png" }, valid.scenes[0]] }));
  writeFileSync(join(outer, "outside", "secret.json"), JSON.stringify(valid));
  symlinkSync(join(outer, "outside", "secret.json"), join(root, "link.json"));
  symlinkSync(join(outer, "outside"), join(root, "linkdir"));
});
afterAll(() => {
  rmSync(outer, { recursive: true, force: true });
});

const report = (output: string): RenderReport => ({
  output, width: 1920, height: 1080, fps: 30, frames: 150, durationSeconds: 5, elapsedMs: 1200, workers: 2, audio: false,
});

async function connect(options: Partial<ServerOptions> = {}) {
  const server = createServer({ root, inspect: async () => ({ slots: [] }), hasSound: async () => true, ...options });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { text: content.map((part) => part.text).join("\n"), isError: result.isError === true };
  };
  return { client, call, close: () => client.close() };
}

describe("the tools on offer", () => {
  it("are six, each with a description a model can choose by", async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["check", "guide", "job", "render", "scene_docs", "transcribe"]);
    for (const tool of tools) expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(40);
    await close();
  });

  it("guide returns the authoring guide and says which tool to use next", async () => {
    const { call, close } = await connect();
    const { text, isError } = await call("guide");
    expect(isError).toBe(false);
    expect(text).toContain("# Making a video with scenefile");
    expect(text).toContain("### stat");
    for (const tool of ["check", "render", "job", "scene_docs"]) expect(text).toContain(`\`${tool}\``);
    expect(text.length).toBeLessThan(10_000);
    await close();
  });

  it("scene_docs explains one scene type, and helps with a misspelt one", async () => {
    const { call, close } = await connect();
    expect((await call("scene_docs", { type: "stat" })).text).toContain("`value`");
    const wrong = await call("scene_docs", { type: "stats" });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain('Did you mean "stat"?');
    expect(wrong.text).toContain("terminal");
    await close();
  });
});

describe("check", () => {
  it("checks a scenefile given as an object, as text, or as text in a code fence", async () => {
    const { call, close } = await connect();
    for (const scenefile of [valid, JSON.stringify(valid), `Here it is:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``]) {
      const { text, isError } = await call("check", { scenefile });
      expect(isError).toBe(false);
      expect(text).toContain("1. title");
      expect(text).toMatch(/No problems found\.|0 errors/);
    }
    await close();
  });

  it("returns every problem with its fix, and the corrected scenefile when it repaired something", async () => {
    const { call, close } = await connect();
    const broken = await call("check", { scenefile: { version: 1, scenes: [{ type: "titel", heading: "x" }] } });
    expect(broken.isError).toBe(false);
    expect(broken.text).toContain("error  SCHEMA_UNKNOWN_SCENE  scenes[0].type");
    expect(broken.text).toContain("fix: ");
    const repaired = await call("check", { scenefile: { version: 1, scenes: [{ type: "title", title: "Ship faster", subtitle: "one two three four" }, valid.scenes[1]] } });
    expect(repaired.text).toContain("warning  AUTOFIXED");
    expect(repaired.text).toContain("Corrected scenefile");
    expect(repaired.text).toContain('"heading": "Ship faster"');
    await close();
  });

  it("reads a scenefile by path, with its images beside it", async () => {
    const { call, close } = await connect();
    expect((await call("check", { path: "video.json" })).text).toContain("No problems found.");
    const nested = await call("check", { path: "sub/nested.json" });
    // The image is one folder up from the scenefile: inside the server's root, but outside the scenefile's own folder.
    expect(nested.text).toContain("ASSET_NOT_FOUND  scenes[0].src");
    const inline = await call("check", { scenefile: { version: 1, scenes: [{ type: "screenshot", src: "shot.png" }, valid.scenes[0]] } });
    // Given inline, a scenefile's images are looked for in the root itself.
    expect(inline.text).toContain("image shot.png");
    expect(inline.text).not.toContain("ASSET_");
    await close();
  });

  it.each([
    ["../outside/secret.json"],
    ["link.json"],
    ["linkdir/secret.json"],
    ["/etc/hosts"],
  ])("refuses to read %s, which is or leads outside the root", async (path) => {
    const { call, close } = await connect();
    const { text, isError } = await call("check", { path });
    expect(isError).toBe(true);
    expect(text).toMatch(/outside/);
    expect(text).not.toContain("Ship faster");
    await close();
  });

  it("needs exactly one of scenefile and path, and says so", async () => {
    const { call, close } = await connect();
    for (const args of [{}, { scenefile: valid, path: "video.json" }]) {
      const { text, isError } = await call("check", args);
      expect(isError).toBe(true);
      expect(text).toMatch(/scenefile.*path|path.*scenefile/);
    }
    expect((await call("check", { path: "nope.json" })).isError).toBe(true);
    await close();
  });

  it("does not download images unless the server was started to allow it", async () => {
    const { call, close } = await connect();
    const { text } = await call("check", { scenefile: { version: 1, scenes: [{ type: "screenshot", src: "https://example.com/a.png" }, valid.scenes[0]] } });
    expect(text).toContain("ASSET_NOT_FOUND  scenes[0].src");
    expect(text).toMatch(/turned off/);
    await close();
  });
});

describe("render and job", () => {
  it("starts a render, reports progress, and then the finished file", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: RenderOptions[] = [];
    const { call, close } = await connect({
      render: async (_composition, options) => {
        seen.push(options);
        options.onProgress?.(30, 150);
        await gate;
        return report(options.output);
      },
    });
    const started = await call("render", { path: "video.json", output: "out/video.mp4", quality: "draft" });
    expect(started.isError).toBe(false);
    const id = /job-\d+/.exec(started.text)?.[0] ?? "";
    expect(id).not.toBe("");
    expect(started.text).toContain("`job`");

    await new Promise((resolve) => setTimeout(resolve, 20));
    const running = await call("job", { id });
    expect(running.isError).toBe(false);
    expect(running.text).toMatch(/30 of \d+ frames/);
    expect(seen[0]).toMatchObject({ output: join(root, "out", "video.mp4"), quality: "draft" });

    release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const done = await call("job", { id });
    expect(done.text).toMatch(/finished/);
    expect(done.text).toContain("out/video.mp4");
    expect(done.text).not.toContain(outer);
    await close();
  });

  it("does not start a render for a scenefile with errors, and shows them", async () => {
    let rendered = false;
    const { call, close } = await connect({ render: async (_c, options) => ((rendered = true), report(options.output)) });
    const { text, isError } = await call("render", { scenefile: { version: 1, scenes: [] }, output: "x.mp4" });
    expect(isError).toBe(true);
    expect(text).toContain("SCHEMA_INVALID");
    expect(text).not.toMatch(/job-\d+/);
    expect(rendered).toBe(false);
    await close();
  });

  it.each([
    ["../escape.mp4", /outside/],
    ["linkdir/escape.mp4", /outside/],
    ["/tmp/escape.mp4", /outside/],
    ["video.json", /\.mp4/],
    ["notes.txt", /\.mp4/],
    ["", /output/],
  ])("refuses the output path %j", async (output, message) => {
    let rendered = false;
    const { call, close } = await connect({ render: async (_c, options) => ((rendered = true), report(options.output)) });
    const { text, isError } = await call("render", { path: "video.json", output });
    expect(isError).toBe(true);
    expect(text).toMatch(message);
    expect(rendered).toBe(false);
    await close();
  });

  it("reports a render that failed, with what to do about it", async () => {
    const { call, close } = await connect({
      render: async () => {
        throw new EnvironmentError("ffmpeg was not found.", "Install ffmpeg: brew install ffmpeg");
      },
    });
    const id = /job-\d+/.exec((await call("render", { path: "video.json", output: "a.mp4" })).text)?.[0] ?? "";
    await new Promise((resolve) => setTimeout(resolve, 20));
    const failed = await call("job", { id });
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain("ffmpeg was not found.");
    expect(failed.text).toContain("brew install ffmpeg");
    await close();
  });

  it("renders one video at a time; a second waits its turn", async () => {
    const releases: (() => void)[] = [];
    let running = 0;
    let most = 0;
    const { call, close } = await connect({
      render: async (_composition, options) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running -= 1;
        return report(options.output);
      },
    });
    const first = /job-\d+/.exec((await call("render", { path: "video.json", output: "one.mp4" })).text)?.[0] ?? "";
    const second = /job-\d+/.exec((await call("render", { path: "video.json", output: "two.mp4" })).text)?.[0] ?? "";
    expect(second).not.toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await call("job", { id: second })).text).toMatch(/waiting/);
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await call("job", { id: first })).text).toMatch(/finished/);
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await call("job", { id: second })).text).toMatch(/finished/);
    expect(most).toBe(1);
    await close();
  });

  it("says so when asked about a job it does not know", async () => {
    const { call, close } = await connect();
    const { text, isError } = await call("job", { id: "job-999" });
    expect(isError).toBe(true);
    expect(text).toMatch(/job-999/);
    await close();
  });

  it("renders a real video, start to finish, inside the root", async () => {
    const server = createServer({ root });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const text = async (name: string, args: Record<string, unknown>): Promise<string> =>
      ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0]?.text ?? "";
    const scenefile = { version: 1, transition: "fade", format: "square-1080p", scenes: [{ type: "title", heading: "Real render", duration: 1.6 }, { type: "title", heading: "Through MCP", duration: 1.6 }] };
    const id = /job-\d+/.exec(await text("render", { scenefile, output: "real/out.mp4", quality: "draft" }))?.[0] ?? "";
    let status = "";
    for (let i = 0; i < 120 && !/finished|failed/.test(status); i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = await text("job", { id });
    }
    expect(status).toMatch(/finished/);
    expect(existsSync(join(root, "real", "out.mp4"))).toBe(true);
    await client.close();
  });
});

describe("limits on what a caller can make the server do", () => {
  const blocked = () => {
    const releases: (() => void)[] = [];
    const aborted: string[] = [];
    const render: NonNullable<ServerOptions["render"]> = (_composition, options) =>
      new Promise<RenderReport>((resolve, reject) => {
        releases.push(() => resolve(report(options.output)));
        options.signal?.addEventListener("abort", () => {
          aborted.push(options.output);
          reject(new EnvironmentError("The render was cancelled.", "Start it again if you still want the video."));
        });
      });
    return { render, releases, aborted };
  };
  const jobId = (text: string): string => /job-\d+/.exec(text)?.[0] ?? "";

  it("does not replace a video that is already there unless told to, and says when it does", async () => {
    writeFileSync(join(root, "precious.mp4"), "a recording");
    const { render } = blocked();
    const { call, close } = await connect({ render });
    const refused = await call("render", { path: "video.json", output: "precious.mp4" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/already exists/);
    expect(refused.text).toContain("overwrite");
    const allowed = await call("render", { path: "video.json", output: "precious.mp4", overwrite: true });
    expect(allowed.isError).toBe(false);
    expect(allowed.text).toMatch(/replac/);
    await close();
  });

  it("never writes the video over the scenefile, however the two paths are spelt", async () => {
    // A scenefile with a video's name, reached through a link to the root, and in another letter case.
    writeFileSync(join(root, "clip.mp4"), JSON.stringify(valid));
    symlinkSync(root, join(outer, "rootlink"));
    const { render, releases } = blocked();
    const { call, close } = await connect({ render, root: join(outer, "rootlink") });
    for (const output of ["clip.mp4", "./sub/../clip.mp4"]) {
      const { text, isError } = await call("render", { path: "clip.mp4", output, overwrite: true });
      expect(isError, output).toBe(true);
      expect(text, output).toMatch(/scenefile itself/);
    }
    expect(releases).toHaveLength(0);
    await close();
  });

  it("holds only so many renders in line, and can cancel one that is waiting or running", async () => {
    const { render, releases, aborted } = blocked();
    const { call, close } = await connect({ render });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(jobId((await call("render", { path: "video.json", output: `q${i}.mp4` })).text));
    expect(ids.every((id) => id !== "")).toBe(true);
    const tooMany = await call("render", { path: "video.json", output: "q6.mp4" });
    expect(tooMany.isError).toBe(true);
    expect(tooMany.text).toMatch(/waiting/);

    // Cancel one that has not started: it never renders.
    const waiting = await call("job", { id: ids[3] ?? "", cancel: true });
    expect(waiting.text).toMatch(/cancelled/);
    // Cancel the one that is running: its renderer is told to stop.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const running = await call("job", { id: ids[0] ?? "", cancel: true });
    expect(running.text).toMatch(/cancel/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(aborted).toEqual([join(root, "q0.mp4")]);
    expect((await call("job", { id: ids[0] ?? "" })).text).toMatch(/cancelled/);

    for (let turn = 0; turn < 8; turn++) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((await call("job", { id: ids[1] ?? "" })).text).toMatch(/finished/);
    expect((await call("job", { id: ids[3] ?? "" })).text).toMatch(/cancelled/);
    expect((await call("job", { id: ids[5] ?? "" })).text).toMatch(/finished/);
    await close();
  });

  it("checks one scenefile at a time, however many arrive together", async () => {
    let busy = 0;
    let most = 0;
    const { call, close } = await connect({
      inspect: async () => {
        busy += 1;
        most = Math.max(most, busy);
        await new Promise((resolve) => setTimeout(resolve, 15));
        busy -= 1;
        return { slots: [] };
      },
    });
    const replies = await Promise.all(Array.from({ length: 6 }, () => call("check", { scenefile: valid })));
    expect(replies.every((reply) => reply.text.includes("No problems found."))).toBe(true);
    expect(most).toBe(1);
    await close();
  });

  it("explains a path that is not a file in plain words", async () => {
    const { call, close } = await connect();
    const { text, isError } = await call("check", { path: "sub" });
    expect(isError).toBe(true);
    expect(text).toMatch(/folder|not a file/);
    expect(text).not.toMatch(/EISDIR|ENOENT/);
    await close();
  });

  it("downloads images only when started to allow it", async () => {
    const png = Buffer.alloc(57);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(360, 20);
    png.write("IDAT", 37, "latin1");
    const requested: string[] = [];
    const network = {
      lookup: async () => [{ address: "93.184.216.34", family: 4 as const }],
      request: async (url: URL) => {
        requested.push(url.href);
        return { status: 200, headers: {}, body: (async function* () { yield new Uint8Array(png); })(), close: () => undefined };
      },
    };
    const scenefile = { version: 1, scenes: [{ type: "screenshot", src: "https://example.com/a.png" }, valid.scenes[0]] };
    const off = await connect({ network });
    expect((await off.call("check", { scenefile })).text).toMatch(/turned off/);
    expect(requested).toEqual([]);
    await off.close();
    const on = await connect({ network, allowRemoteImages: true });
    const allowed = await on.call("check", { scenefile });
    expect(allowed.text).not.toContain("ASSET_");
    expect(requested).toEqual(["https://example.com/a.png"]);
    await on.close();
  });
});

describe("narration through the server", () => {
  it("never downloads a voice: one that is missing is reported with how to install it", async () => {
    const before = process.env.SCENEFILE_HOME;
    process.env.SCENEFILE_HOME = join(outer, "empty-home");
    try {
      const { call, close } = await connect();
      const narrated = { ...valid, scenes: [{ ...valid.scenes[0], say: "This tool deploys your site." }, valid.scenes[1]] };
      const { text } = await call("check", { scenefile: narrated });
      expect(text).toContain("VOICE_FAILED");
      expect(text).toContain("scenefile voices install en-emma");
      await close();
    } finally {
      if (before === undefined) delete process.env.SCENEFILE_HOME;
      else process.env.SCENEFILE_HOME = before;
    }
  });
});

describe("capturing a web page through the server", () => {
  const shoot = (seen: string[]) => async (options: { output: string; device?: string }) => {
    seen.push(options.output);
    return { output: options.output, width: 2880, height: 1800, device: "desktop" as const, title: "Home", url: "http://localhost:3000/", full: true };
  };

  it("is not offered unless the server was started to allow it", async () => {
    const seen: string[] = [];
    const { call, close } = await connect({ capture: shoot(seen) });
    const reply = await call("capture", { url: "http://localhost:3000", output: "home.png" }).catch(() => ({ isError: true, text: "" }));
    expect(reply.isError).toBe(true);
    expect(seen).toEqual([]);
    await close();
  });

  it("saves only inside the root, as a PNG, and never over a file that is there", async () => {
    const seen: string[] = [];
    writeFileSync(join(root, "kept.png"), "mine");
    const { call, close } = await connect({ allowCapture: true, capture: shoot(seen) });
    for (const output of ["../out.png", join(outer, "x.png"), "page.html", "kept.png"]) {
      const { isError } = await call("capture", { url: "http://localhost:3000", output });
      expect(isError, output).toBe(true);
    }
    expect(seen).toEqual([]);
    const { text, isError } = await call("capture", { url: "http://localhost:3000", output: "shots/home.png" });
    expect(isError).toBe(false);
    expect(seen).toEqual([join(root, "shots", "home.png")]);
    expect(text).toContain('"src": "shots/home.png"');
    await close();
  });
});

describe("listening to a file through the server", () => {
  it("says what is spoken, only for files inside the root", async () => {
    writeFileSync(join(root, "talk.mp4"), "x");
    const asked: string[] = [];
    const { call, close } = await connect({
      transcribe: async (file) => {
        asked.push(file);
        return [{ start: 0.5, end: 3.2, text: "Here are two recordings." }];
      },
    });
    const { text, isError } = await call("transcribe", { path: "talk.mp4" });
    expect(isError).toBe(false);
    expect(text).toBe("0.50s - 3.20s  Here are two recordings.");
    expect((await call("transcribe", { path: "../talk.mp4" })).isError).toBe(true);
    // A check waiting its turn is not held up by listening, which has a queue of its own.
    expect((await call("guide")).text).toContain("transcribe");
    expect((await call("transcribe", { path: "missing.mp4" })).isError).toBe(true);
    expect(asked).toHaveLength(1);
    await close();
  });
});

describe("where the server may work", () => {
  it("refuses a root that is not an existing folder", () => {
    expect(() => createServer({ root: join(outer, "no-such-folder") })).toThrow(/folder/);
    expect(() => createServer({ root: join(root, "video.json") })).toThrow(/folder/);
  });

  it("refuses to treat the whole disk as its root", () => {
    expect(() => createServer({ root: "/" })).toThrow(/root/);
  });
});
