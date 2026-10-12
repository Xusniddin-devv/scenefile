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
  it("are five, each with a description a model can choose by", async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["check", "guide", "job", "render", "scene_docs"]);
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
    expect(text.length).toBeLessThan(9000);
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

describe("where the server may work", () => {
  it("refuses to treat the whole disk as its root", () => {
    expect(() => createServer({ root: "/" })).toThrow(/root/);
  });
});
