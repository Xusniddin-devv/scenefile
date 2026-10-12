import { describe, expect, it } from "vitest";
import { applyLayout, check } from "../src/check";
import { type SlotReport, verifyLayout } from "../src/layout";

const slot = (over: Partial<SlotReport>): SlotReport => ({
  path: "scenes[0].heading", sizePx: 100, lines: 2, maxLines: 3, chars: 40, overflow: false, outside: false, ...over,
});

const valid = {
  version: 1,
  scenes: [{ type: "title", heading: "Ship faster", sub: "A CLI for X" }, { type: "terminal", steps: [{ run: "npx x init" }] }],
};

describe("verifyLayout", () => {
  it("accepts slots that fit", () => {
    expect(verifyLayout({ slots: [slot({}), slot({ path: "scenes[1].steps", maxLines: null })] })).toEqual([]);
  });

  it("gives a character budget when text needs too many lines", () => {
    const [diagnostic, ...rest] = verifyLayout({ slots: [slot({ overflow: true, lines: 5, chars: 100 })] });
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ code: "TEXT_OVERFLOW", severity: "error", path: "scenes[0].heading" });
    expect(diagnostic?.message).toContain("5 lines");
    expect(diagnostic?.message).toContain("3");
    // 100 chars over 5 lines is 20 per line; 3 lines hold 60; keep 10% spare.
    expect(diagnostic?.fix).toContain("54 characters");
    expect(diagnostic?.fix).toContain("100");
  });

  it("says a word is too long when the line count is fine but a word had to be broken", () => {
    const [diagnostic] = verifyLayout({ slots: [slot({ overflow: true, lines: 3, chars: 68 })] });
    expect(diagnostic).toMatchObject({ code: "TEXT_OVERFLOW", path: "scenes[0].heading" });
    expect(diagnostic?.message).toContain("word");
    expect(diagnostic?.fix).toMatch(/shorter words/);
  });

  it("asks for less content when a block is too tall", () => {
    const [diagnostic] = verifyLayout({ slots: [slot({ path: "scenes[1].steps", maxLines: null, overflow: true })] });
    expect(diagnostic).toMatchObject({ code: "TEXT_OVERFLOW", path: "scenes[1].steps" });
    expect(diagnostic?.fix).toMatch(/fewer|shorter|split/);
  });

  it("reports text outside the safe area, once, and not on top of an overflow", () => {
    expect(verifyLayout({ slots: [slot({ outside: true })] })).toEqual([
      expect.objectContaining({ code: "SAFE_AREA", severity: "error", path: "scenes[0].heading" }),
    ]);
    expect(verifyLayout({ slots: [slot({ outside: true, overflow: true, lines: 4 })] })).toHaveLength(1);
  });
});

describe("crowded scenes", () => {
  it("reports a scene whose content runs into the top of the frame", () => {
    expect(verifyLayout({ slots: [slot({})], crowded: [0, 2] })).toEqual([
      expect.objectContaining({ code: "SAFE_AREA", severity: "error", path: "scenes[0]" }),
      expect.objectContaining({ code: "SAFE_AREA", severity: "error", path: "scenes[2]" }),
    ]);
  });

  it("does not repeat itself for a scene that already has a layout error", () => {
    const diagnostics = verifyLayout({ slots: [slot({ overflow: true, lines: 5 })], crowded: [0] });
    expect(diagnostics.map((d) => d.code)).toEqual(["TEXT_OVERFLOW"]);
  });
});

describe("applyLayout", () => {
  it("adds sizes and line counts to the storyboard", () => {
    const result = applyLayout(check(valid), {
      slots: [
        slot({ sizePx: 237.6, lines: 1 }),
        slot({ path: "scenes[0].sub", sizePx: 49.68, lines: 1, maxLines: 4 }),
        slot({ path: "scenes[1].steps", sizePx: 47.52, lines: 1, maxLines: null }),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.storyboard.split("\n")).toEqual([
      "1920x1080, 30 fps, 5.40s, 2 scenes",
      "1. title     0.00s-3.00s  Ship faster",
      "     heading  238px, 1 line",
      "     sub      50px, 1 line",
      "2. terminal  3.00s-5.40s  $ npx x init",
      "     steps  48px",
    ]);
  });

  it("blocks rendering when layout fails but keeps the storyboard", () => {
    const result = applyLayout(check(valid), { slots: [slot({ overflow: true, lines: 6, chars: 80 })] });
    expect(result.ok).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toEqual(["TEXT_OVERFLOW"]);
    expect(result.storyboard).toContain("1. title");
  });

  it("leaves a result that already failed untouched", () => {
    const failed = check({ version: 1, scenes: [{ type: "nope" }] });
    expect(applyLayout(failed, { slots: [slot({ overflow: true })] })).toEqual(failed);
  });
});
