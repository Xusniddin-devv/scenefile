import { mkdtempSync, rmSync } from "node:fs";
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
