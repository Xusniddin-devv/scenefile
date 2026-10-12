import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvironmentError, type RenderReport } from "@scenefile/render";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Io, run } from "../src/run";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-cli-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

function capture(
  render?: Io["render"],
  inspect: NonNullable<Io["inspect"]> = async () => ({ slots: [] }),
): { io: Io; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text), inspect, ...(render ? { render } : {}) },
    out: () => out.join("\n"),
    err: () => err.join("\n"),
  };
}

const valid = JSON.stringify({
  version: 1,
  scenes: [{ type: "title", heading: "Ship faster" }, { type: "terminal", steps: [{ run: "npx x" }] }],
});

const report: RenderReport = {
  output: "/tmp/out.mp4", width: 1920, height: 1080, fps: 30, frames: 150, durationSeconds: 5, elapsedMs: 1234,
};

describe("scenefile check", () => {
  it("prints the storyboard and exits 0 for a valid scenefile", async () => {
    const c = capture();
    expect(await run(["check", file("ok.json", valid)], c.io)).toBe(0);
    expect(c.out()).toContain("1. title");
    expect(c.out()).toContain("No problems found.");
  });

  it("prints each diagnostic with its path and fix, and exits 1", async () => {
    const c = capture();
    const path = file("bad.json", JSON.stringify({ version: 1, scenes: [{ type: "titel", heading: "x" }] }));
    expect(await run(["check", path], c.io)).toBe(1);
    expect(c.out()).toContain("error  SCHEMA_UNKNOWN_SCENE  scenes[0].type");
    expect(c.out()).toContain('Did you mean "title"?');
    expect(c.out()).toContain("fix: ");
    expect(c.out()).toContain("1 error, 0 warnings");
  });

  it("emits machine-readable JSON with --json", async () => {
    const c = capture();
    expect(await run(["check", file("ok2.json", valid), "--json"], c.io)).toBe(0);
    const parsed = JSON.parse(c.out()) as { ok: boolean; diagnostics: unknown[]; storyboard: string; scenefile: { fps: number } };
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.scenefile.fps).toBe(30);
    expect(parsed.storyboard).toContain("2. terminal");
    expect(parsed).not.toHaveProperty("composition");
  });

  it("accepts JSON wrapped in a code fence, with a warning", async () => {
    const c = capture();
    expect(await run(["check", file("fenced.json", `\`\`\`json\n${valid}\n\`\`\``)], c.io)).toBe(0);
    expect(c.out()).toContain("warning  AUTOFIXED");
  });

  it.each([
    ["empty.json", ""],
    ["prose.json", "Sure! Here is your video."],
  ])("reports %s as a diagnostic, not a stack trace", async (name, contents) => {
    const c = capture();
    expect(await run(["check", file(name, contents)], c.io)).toBe(1);
    expect(c.out()).toContain("SCHEMA_JSON");
    expect(c.out() + c.err()).not.toMatch(/\bat .+:\d+:\d+/);
  });

  it("reports text that does not fit, found by inspecting the layout", async () => {
    const c = capture(undefined, async () => ({
      slots: [
        { path: "scenes[0].heading", sizePx: 86.4, lines: 5, maxLines: 3, chars: 70, overflow: true, outside: false },
      ],
    }));
    expect(await run(["check", file("long.json", valid)], c.io)).toBe(1);
    expect(c.out()).toContain("error  TEXT_OVERFLOW  scenes[0].heading");
    expect(c.out()).toContain("characters");
    expect(c.out()).toContain("heading  86px, 5 lines");
  });

  it("does not inspect a scenefile that already has errors", async () => {
    let inspected = false;
    const c = capture(undefined, async () => {
      inspected = true;
      return { slots: [] };
    });
    expect(await run(["check", file("broken3.json", JSON.stringify({ version: 1, scenes: [] }))], c.io)).toBe(1);
    expect(inspected).toBe(false);
  });

  it("exits 2 when the browser needed for layout checks is missing", async () => {
    const c = capture(undefined, async () => {
      throw new EnvironmentError("Chromium is not installed for scenefile.", "Install the browser: ...");
    });
    expect(await run(["check", file("nobrowser.json", valid)], c.io)).toBe(2);
    expect(c.err()).toContain("Chromium is not installed");
  });

  it("reports a missing file as a diagnostic", async () => {
    const c = capture();
    expect(await run(["check", join(dir, "nope.json")], c.io)).toBe(1);
    expect(c.out()).toContain("SCHEMA_FILE");
  });
});

describe("scenefile render", () => {
  it("renders through the pipeline and reports the result", async () => {
    const calls: { output: string; quality: string | undefined }[] = [];
    const c = capture(async (_composition, options) => {
      calls.push({ output: options.output, quality: options.quality });
      return report;
    });
    expect(await run(["render", file("r.json", valid), "-o", "out/video.mp4", "--quality", "high"], c.io)).toBe(0);
    expect(calls).toEqual([{ output: "out/video.mp4", quality: "high" }]);
    expect(c.out()).toContain("/tmp/out.mp4");
    expect(c.out()).toContain("5.00s");
  });

  it("does not render when the scenefile has errors", async () => {
    let called = false;
    const c = capture(async () => {
      called = true;
      return report;
    });
    const path = file("bad2.json", JSON.stringify({ version: 1, scenes: [] }));
    expect(await run(["render", path, "-o", "x.mp4"], c.io)).toBe(1);
    expect(called).toBe(false);
  });

  it("exits 2 with the remedy when the environment is missing something", async () => {
    const c = capture(async () => {
      throw new EnvironmentError("ffmpeg was not found.", "Install ffmpeg: brew install ffmpeg");
    });
    expect(await run(["render", file("r2.json", valid), "-o", "x.mp4"], c.io)).toBe(2);
    expect(c.err()).toContain("ffmpeg was not found.");
    expect(c.err()).toContain("brew install ffmpeg");
  });

  it("refuses an output that is not an .mp4 or that is the scenefile itself", async () => {
    let called = false;
    const render: Io["render"] = async () => {
      called = true;
      return report;
    };
    const input = file("victim.json", valid);
    const a = capture(render);
    expect(await run(["render", input, "-o", input], a.io)).toBe(2);
    expect(a.err()).toContain(".mp4");
    const b = capture(render);
    expect(await run(["render", input, "-o", "out.mov"], b.io)).toBe(2);
    const same = file("same.mp4", valid);
    const c = capture(render);
    expect(await run(["render", same, "-o", same], c.io)).toBe(2);
    expect(c.err()).toContain("same file");
    expect(called).toBe(false);
  });

  it("requires an output path and a known quality", async () => {
    const a = capture();
    expect(await run(["render", file("r3.json", valid)], a.io)).toBe(2);
    expect(a.err()).toContain("-o");
    const b = capture();
    expect(await run(["render", file("r4.json", valid), "-o", "x.mp4", "--quality", "ultra"], b.io)).toBe(2);
    expect(b.err()).toContain("draft, standard, high");
  });
});

describe("scenefile usage", () => {
  it("prints help and exits 0", async () => {
    const c = capture();
    expect(await run(["--help"], c.io)).toBe(0);
    expect(c.out()).toContain("scenefile check <file>");
  });

  it.each([[[]], [["frobnicate"]], [["check"]], [["check", "a.json", "--bogus"]]])(
    "exits 2 with usage for %j",
    async (argv) => {
      const c = capture();
      expect(await run(argv, c.io)).toBe(2);
      expect(c.err()).toContain("Usage:");
    },
  );
});
