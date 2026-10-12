import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeVideo } from "@scenefile/render";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function scenefile(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ code: error && typeof error.code === "number" ? error.code : 0, stdout, stderr });
    });
  });
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-e2e-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("built CLI", () => {
  it("renders a scenefile to a playable MP4", async () => {
    const input = join(dir, "video.json");
    const output = join(dir, "video.mp4");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        transition: "fade",
        format: "square-1080p",
        scenes: [
          { type: "title", heading: "Hello", duration: 1.5 },
          { type: "terminal", steps: [{ run: "echo hi", output: "hi" }], duration: 2 },
        ],
      }),
    );

    const result = await scenefile(["render", input, "-o", output, "--quality", "draft"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(await probeVideo(output)).toMatchObject({ width: 1080, height: 1080, frames: 105 });
  });

  it("finds text that cannot fit by measuring it in the browser", async () => {
    const input = join(dir, "overflow.json");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        scenes: [
          { type: "title", heading: "Supercalifragilisticexpialidocious".repeat(2), sub: "x" },
          { type: "title", heading: "one two three four five six seven eight nine" },
        ],
      }),
    );
    const result = await scenefile(["check", input]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("TEXT_OVERFLOW  scenes[0].heading");
    expect(result.stdout).toMatch(/heading\s+\d+px, \d+ lines/);
  });

  it("leaves nothing behind when interrupted", async () => {
    const input = join(dir, "long.json");
    const output = join(dir, "interrupted.mp4");
    writeFileSync(
      input,
      JSON.stringify({ version: 1, scenes: Array.from({ length: 4 }, (_, i) => ({ type: "title", heading: `Part ${i} one two three`, duration: 5 })) }),
    );
    const child = spawn(process.execPath, [cli, "render", input, "-o", output, "--workers", "2"], { stdio: "ignore" });
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    // Wait until rendering is really under way, however busy the machine is, then a little longer.
    const underWay = (): boolean => readdirSync(dir).some((name) => name.startsWith(".interrupted.mp4.partial-"));
    for (let waited = 0; waited < 30_000 && !underWay(); waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(underWay()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    child.kill("SIGINT");
    await exited;
    expect(existsSync(output)).toBe(false);
    expect(readdirSync(dir).filter((name) => name.includes("partial"))).toEqual([]);
  });

  it("refuses to serve the whole disk, plainly", async () => {
    const result = await scenefile(["mcp", "--root", "/"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("filesystem root");
    expect(result.stderr).not.toMatch(/\bat .+:\d+:\d+/);
    const unknown = await scenefile(["mcp", "--bogus"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("Usage: scenefile mcp");
  });

  it("exits 1 and prints diagnostics for a broken scenefile", async () => {
    const input = join(dir, "broken.json");
    writeFileSync(input, "{ not json");
    const result = await scenefile(["check", input]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("SCHEMA_JSON");
  });
});
