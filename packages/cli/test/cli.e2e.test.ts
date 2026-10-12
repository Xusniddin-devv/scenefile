import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("exits 1 and prints diagnostics for a broken scenefile", async () => {
    const input = join(dir, "broken.json");
    writeFileSync(input, "{ not json");
    const result = await scenefile(["check", input]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("SCHEMA_JSON");
  });
});
