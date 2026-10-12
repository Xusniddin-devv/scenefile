import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  output: "/tmp/out.mp4", width: 1920, height: 1080, fps: 30, frames: 150, durationSeconds: 5, elapsedMs: 1234, workers: 2, audio: false,
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

  it("passes the number of workers through, and refuses one that makes no sense", async () => {
    const seen: (number | undefined)[] = [];
    const render: Io["render"] = async (_composition, options) => {
      seen.push(options.workers);
      return report;
    };
    const input = file("workers.json", valid);
    expect(await run(["render", input, "-o", "x.mp4", "--workers", "3"], capture(render).io)).toBe(0);
    expect(await run(["render", input, "-o", "x.mp4"], capture(render).io)).toBe(0);
    expect(seen).toEqual([3, undefined]);
    for (const bad of ["0", "-2", "many", "1.5", "99", "2e0", "0x2", " 2", "1.0"]) {
      const c = capture(render);
      expect(await run(["render", input, "-o", "x.mp4", "--workers", bad], c.io), bad).toBe(2);
      expect(c.err()).toContain("--workers");
    }
    expect(seen).toHaveLength(2);
  });

  it("reports music that has no sound in it before rendering anything", async () => {
    const folder = mkdtempSync(join(tmpdir(), "scenefile-cli-music-"));
    try {
      writeFileSync(join(folder, "bed.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
      const input = join(folder, "music.json");
      writeFileSync(input, JSON.stringify({ ...JSON.parse(valid), audio: { src: "bed.mp3" } }));
      let rendered = false;
      const render: Io["render"] = async () => {
        rendered = true;
        return report;
      };
      const silent = capture(render);
      silent.io.hasSound = async () => false;
      expect(await run(["render", input, "-o", "x.mp4"], silent.io)).toBe(1);
      expect(silent.out()).toContain("error  ASSET_UNSUPPORTED  audio.src");
      expect(rendered).toBe(false);

      const sounding = capture(render);
      sounding.io.hasSound = async () => true;
      expect(await run(["check", input], sounding.io)).toBe(0);
      expect(sounding.out()).toContain(", music");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
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

describe("commands that explain", () => {
  it("guide prints the authoring guide", async () => {
    const c = capture();
    expect(await run(["guide"], c.io)).toBe(0);
    expect(c.out()).toContain("# Making a video with scenefile");
    expect(c.out()).toContain("### terminal");
  });

  it("scenes lists every scene type with what it is for, and one type in full", async () => {
    const list = capture();
    expect(await run(["scenes"], list.io)).toBe(0);
    for (const type of ["title", "statement", "quote", "bullets", "stat", "code", "screenshot", "compare", "outro", "terminal"]) {
      expect(list.out(), type).toMatch(new RegExp(`^${type}\\s+\\S`, "m"));
    }
    const one = capture();
    expect(await run(["scenes", "stat"], one.io)).toBe(0);
    expect(one.out()).toContain("`value`");
    const wrong = capture();
    expect(await run(["scenes", "stats"], wrong.io)).toBe(2);
    expect(wrong.err()).toContain('Did you mean "stat"?');
  });

  it("schema prints a JSON Schema of the scenefile", async () => {
    const c = capture();
    expect(await run(["schema"], c.io)).toBe(0);
    const schema = JSON.parse(c.out()) as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["version", "scenes", "theme", "transition", "audio"]));
    expect(schema.required).toEqual(expect.arrayContaining(["version", "scenes"]));
    expect(JSON.stringify(schema)).toContain('"statement"');
  });

  it("init writes a scenefile that passes its own check, and never overwrites one", async () => {
    const folder = mkdtempSync(join(tmpdir(), "scenefile-init-"));
    try {
      const first = capture();
      expect(await run(["init", folder], first.io)).toBe(0);
      const written = join(folder, "scenefile.json");
      expect(first.out()).toContain(written);
      expect(first.out()).toContain("scenefile check");
      const checked = capture();
      expect(await run(["check", written], checked.io)).toBe(0);
      expect(checked.out()).toContain("No problems found.");

      const onFile = capture();
      expect(await run(["init", written], onFile.io)).toBe(1);
      expect(onFile.err()).toMatch(/not a folder|is a file/);
      expect(onFile.err()).not.toMatch(/\bat .+:\d+:\d+/);

      writeFileSync(written, "mine");
      const second = capture();
      expect(await run(["init", folder], second.io)).toBe(1);
      expect(second.err()).toMatch(/already/);
      expect(readFileSync(written, "utf8")).toBe("mine");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("scenefile usage", () => {
  it("prints help and exits 0", async () => {
    const c = capture();
    expect(await run(["--help"], c.io)).toBe(0);
    expect(c.out()).toContain("scenefile check <file>");
    for (const command of ["guide", "scenes", "schema", "init", "mcp"]) expect(c.out()).toContain(`scenefile ${command}`);
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

describe("doctor", () => {
  const found = [
    { name: "Node", ok: true, required: true, detail: "22.1.0" },
    { name: "ffmpeg", ok: true, required: true, detail: "7.1" },
    { name: "Chromium", ok: true, required: true, detail: "ready" },
    { name: "Voice en-kristin", ok: false, required: false, detail: "not installed", fix: "scenefile voices install en-kristin" },
  ];

  it("lists what is in place, and passes when only optional things are missing", async () => {
    const { io, out } = capture();
    expect(await run(["doctor"], { ...io, diagnose: async () => found })).toBe(0);
    expect(out()).toMatch(/ok\s+Node\s+22\.1\.0/);
    expect(out()).toMatch(/optional\s+Voice en-kristin\s+not installed/);
    expect(out()).toContain("scenefile voices install en-kristin");
    expect(out()).toContain("Ready to make videos.");
  });

  it("exits 2 and says how to fix it when something required is missing", async () => {
    const { io, out } = capture();
    const broken = [...found.slice(0, 1), { name: "ffmpeg", ok: false, required: true, detail: "not found", fix: "Install ffmpeg." }];
    expect(await run(["doctor"], { ...io, diagnose: async () => broken })).toBe(2);
    expect(out()).toMatch(/missing\s+ffmpeg\s+not found/);
    expect(out()).toContain("Install ffmpeg.");
    expect(out()).not.toContain("Ready to make videos.");
  });
});
