import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url));

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scenefile-stdio-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const long = {
  version: 1,
  scenes: Array.from({ length: 6 }, (_, i) => ({ type: "title", heading: `Part ${i} one two three`, duration: 5 })),
};

async function startRendering(): Promise<{ client: Client; pid: number }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--root", root] });
  const client = new Client({ name: "e2e", version: "0" });
  await client.connect(transport);
  const text = async (name: string, args: Record<string, unknown>): Promise<string> =>
    ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0]?.text ?? "";
  const id = /job-\d+/.exec(await text("render", { scenefile: long, output: `stop-${Date.now()}.mp4`, workers: 2 }))?.[0] ?? "";
  for (let waited = 0; waited < 40_000; waited += 250) {
    if (/rendering, [1-9]/.test(await text("job", { id }))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { client, pid: transport.pid ?? 0 };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  for (let waited = 0; waited < ms && alive(pid); waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
  return !alive(pid);
}

describe("stopping the server while it renders", () => {
  it.each(["SIGTERM", "SIGHUP"] as const)("stops at once on %s and leaves no scratch folder", async (signal) => {
    const { client, pid } = await startRendering();
    expect(pid).toBeGreaterThan(0);
    process.kill(pid, signal);
    expect(await goneWithin(pid, 4000)).toBe(true);
    expect(readdirSync(root).filter((name) => name.includes("partial"))).toEqual([]);
    await client.close().catch(() => undefined);
  });

  it("stops when its client goes away, instead of finishing the queue for nobody", async () => {
    const { client, pid } = await startRendering();
    const closing = client.close();
    expect(await goneWithin(pid, 3000)).toBe(true);
    await closing.catch(() => undefined);
    expect(readdirSync(root).filter((name) => name.includes("partial"))).toEqual([]);
  });
});

describe("scenefile mcp, as a client would start it", () => {
  it("speaks the protocol over standard input and output, and nothing else", async () => {
    // A stray line on standard output would break the protocol; connecting and calling proves there is none.
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--root", root] });
    const client = new Client({ name: "e2e", version: "0" });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["check", "guide", "job", "render", "scene_docs"]);
      const guide = await client.callTool({ name: "guide", arguments: {} });
      expect((guide.content as { text: string }[])[0]?.text).toContain("# Making a video with scenefile");
      const checked = await client.callTool({
        name: "check",
        arguments: { scenefile: { version: 1, scenes: [{ type: "title", heading: "Over stdio", sub: "one two three four five" }] } },
      });
      expect((checked.content as { text: string }[])[0]?.text).toContain("No problems found.");
    } finally {
      await client.close();
    }
  });
});
