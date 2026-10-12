import { check, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { inspectComposition } from "../src/index";

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
    expect(few.slot("scenes[0].steps").sizePx).toBeCloseTo(4.4 * UNIT, 1);
    expect(few.diagnostics).toEqual([]);

    const step = { run: "x".repeat(120), output: "y ".repeat(200).trim() };
    const many = await inspect({ scenes: [{ type: "terminal", steps: Array.from({ length: 6 }, () => step) }] });
    expect(many.slot("scenes[0].steps").overflow).toBe(true);
    expect(many.diagnostics).toEqual([expect.objectContaining({ code: "TEXT_OVERFLOW", path: "scenes[0].steps" })]);
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
