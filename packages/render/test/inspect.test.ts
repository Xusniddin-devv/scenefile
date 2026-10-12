import { check, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { captureFrame, inspectComposition, openComposition } from "../src/index";

async function inspect(input: Record<string, unknown>) {
  const result = check({ version: 1, ...input });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  const report = await inspectComposition(result.composition);
  const slot = (path: string) => {
    const found = report.slots.find((entry) => entry.path === path);
    if (!found) throw new Error(`no slot ${path} in ${report.slots.map((s) => s.path).join(", ")}`);
    return found;
  };
  return { report, slot, diagnostics: verifyLayout(report) };
}

const filler = { type: "title", heading: "one two three four five six seven eight nine" };
const UNIT = 10.8;

describe("text fitting", () => {
  it("gives a short heading the largest size", async () => {
    const { slot, diagnostics } = await inspect({ scenes: [{ type: "title", heading: "Hi", sub: "there" }, filler] });
    expect(slot("scenes[0].heading")).toMatchObject({ lines: 1, overflow: false, outside: false, chars: 2 });
    expect(slot("scenes[0].heading").sizePx).toBeCloseTo(22 * UNIT, 1);
    expect(slot("scenes[0].sub").sizePx).toBeCloseTo(4.6 * UNIT, 1);
    expect(diagnostics).toEqual([]);
  });

  it("shrinks a long heading until it fits within three lines", async () => {
    const heading = "Render the same video from the same file on every machine";
    const { slot, diagnostics } = await inspect({ scenes: [{ type: "title", heading }, filler] });
    const fitted = slot("scenes[0].heading");
    expect(fitted.sizePx).toBeLessThan(22 * UNIT);
    expect(fitted.sizePx).toBeGreaterThanOrEqual(8 * UNIT - 0.01);
    expect(fitted.lines).toBeLessThanOrEqual(3);
    expect(fitted.overflow).toBe(false);
    expect(diagnostics).toEqual([]);
  });

  it("reports a heading that cannot fit, with a character budget", async () => {
    const heading = "Supercalifragilisticexpialidocious".repeat(2);
    const { slot, diagnostics } = await inspect({ scenes: [{ type: "title", heading, sub: "x" }, filler] });
    expect(slot("scenes[0].heading").overflow).toBe(true);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "TEXT_OVERFLOW", path: "scenes[0].heading" }),
    ]);
    expect(diagnostics[0]?.fix).toMatch(/shorter words|about \d+ characters/);
  });

  it("shrinks terminal text to fit its area, and reports when it cannot", async () => {
    const few = await inspect({ scenes: [{ type: "terminal", steps: [{ run: "ls" }, { run: "pwd" }] }, filler] });
    expect(few.slot("scenes[0].steps").sizePx).toBeCloseTo(6 * UNIT, 1);
    expect(few.diagnostics).toEqual([]);

    const step = { run: "x".repeat(120), output: "y ".repeat(200).trim() };
    const many = await inspect({ scenes: [{ type: "terminal", steps: Array.from({ length: 6 }, () => step) }] });
    expect(many.slot("scenes[0].steps").overflow).toBe(true);
    expect(many.diagnostics).toEqual([expect.objectContaining({ code: "TEXT_OVERFLOW", path: "scenes[0].steps" })]);
  });

  it("sizes a terminal session so its longest command stays on one line", async () => {
    const run = "scenefile render launch.json -o launch.mp4";
    const result = check({ version: 1, scenes: [{ type: "terminal", steps: [{ run, output: "Rendered launch.mp4" }] }, filler] });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const report = await inspectComposition(result.composition);
    const size = report.slots.find((entry) => entry.path === "scenes[0].steps")?.sizePx ?? 0;
    expect(size).toBeGreaterThan(4 * UNIT);
    expect(size).toBeLessThanOrEqual(6 * UNIT + 0.01);

    const session = await openComposition(result.composition);
    try {
      const scene = result.composition.manifest.scenes[0];
      if (!scene) throw new Error("no scene");
      await captureFrame(session.page, scene.durationFrames - scene.exitFrames - 1);
      const linesTall = await session.page.evaluate(() => {
        const cmd = document.querySelector<HTMLElement>(".sf-terminal__cmd");
        if (!cmd) return 0;
        return cmd.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(cmd).lineHeight);
      });
      expect(linesTall).toBeCloseTo(1, 1);
    } finally {
      await session.close();
    }
  });

  it("lets one long command wrap rather than shrinking the whole session to fit it on a line", async () => {
    const long = `docker run --rm -it -v "$PWD":/work -w /work -e NODE_ENV=production ghcr.io/example/scenefile:latest render a.json`;
    const { slot, diagnostics } = await inspect({ scenes: [{ type: "terminal", steps: [{ run: "npx x init" }, { run: long }] }] });
    expect(long.length).toBeGreaterThan(100);
    expect(slot("scenes[0].steps").overflow).toBe(false);
    expect(slot("scenes[0].steps").sizePx).toBeGreaterThanOrEqual(5 * UNIT);
    // The long command wraps, which is allowed but said.
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([["TEXT_WRAPPED", "warning"]]);
  });

  it("never sets terminal text below the minimum readable size", async () => {
    const step = { run: "x".repeat(120), output: "y ".repeat(200).trim() };
    const { slot } = await inspect({ scenes: [{ type: "terminal", steps: Array.from({ length: 6 }, () => step) }] });
    expect(slot("scenes[0].steps").sizePx).toBeGreaterThanOrEqual(3.4 * UNIT - 0.01);
  });

  it("says when code lines were too long to stay on one line", async () => {
    const lines = [
      'const account = await api.accounts.create({ email: "ada@example.com", plan: "team" });',
      "await api.profiles.update(account.id, { name: user.name, timezone: user.timezone });",
    ];
    const long = await inspect({ scenes: [{ type: "code", lang: "ts", source: lines.join("\n") }, filler] });
    expect(long.slot("scenes[0].source").wrapped).toBe(true);
    expect(long.diagnostics).toEqual([
      expect.objectContaining({ code: "TEXT_WRAPPED", severity: "warning", path: "scenes[0].source" }),
    ]);
    const short = await inspect({ scenes: [{ type: "code", lang: "ts", source: "const a = 1;\nconst b = 2;" }, filler] });
    expect(short.slot("scenes[0].source").wrapped).toBeFalsy();
    expect(short.diagnostics).toEqual([]);
  });

  it("keeps the heading wide in portrait and square formats", async () => {
    for (const [format, width] of [["portrait-1080p", 1080], ["square-1080p", 1080]] as const) {
      const { report, diagnostics } = await inspect({
        format,
        scenes: [{ type: "title", heading: "Video from JSON.", sub: "Any model can write a scenefile." }, filler],
      });
      expect(diagnostics, format).toEqual([]);
      expect(report.slots.every((entry) => !entry.outside), format).toBe(true);
      // Fits "Video from" on one line only if the heading has most of the frame's width.
      const heading = report.slots.find((entry) => entry.path === "scenes[0].heading");
      expect(heading?.sizePx, format).toBeGreaterThanOrEqual(12 * (width / 100));
    }
  });

  it("is repeatable: two inspections of one composition agree exactly", async () => {
    const input = { scenes: [{ type: "title", heading: "Render the same video from the same file", sub: "Every time." }, filler] };
    expect((await inspect(input)).report).toEqual((await inspect(input)).report);
  });
});
