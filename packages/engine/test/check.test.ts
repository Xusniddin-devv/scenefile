import { describe, expect, it } from "vitest";
import { check } from "../src/check";

describe("check", () => {
  it("returns a composition and storyboard for a valid scenefile", () => {
    const result = check({
      version: 1,
      transition: "fade",
      scenes: [
        { type: "title", heading: "Ship faster", sub: "A CLI for X" },
        { type: "terminal", steps: [{ run: "npx x init", output: "Done in 2s" }] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.composition?.manifest.scenes).toHaveLength(2);
    expect(result.storyboard.split("\n")).toEqual([
      "1920x1080, 30 fps, 6.70s, 2 scenes",
      "1. title     0.00s-3.00s  Ship faster",
      "2. terminal  3.00s-6.70s  $ npx x init  (enters by fade)",
    ]);
  });

  it("is ok with warnings and keeps them", () => {
    const result = check({
      version: 1,
      scenes: [{ type: "title", title: "Hi" }, { type: "title", heading: "Yo" }],
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["AUTOFIXED"]);
    expect(result.scenefile?.scenes[0]).toMatchObject({ heading: "Hi" });
  });

  it("returns no composition when validation fails", () => {
    const result = check({ version: 1, scenes: [{ type: "nope" }] });
    expect(result).toMatchObject({ ok: false, scenefile: null, composition: null, storyboard: "" });
  });

  it("returns no composition when resolving fails, but keeps the normalized scenefile", () => {
    const result = check({ version: 1, scenes: [{ type: "title", heading: "Hi" }] });
    expect(result.ok).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.scenefile).not.toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toEqual(["TOTAL_DURATION"]);
  });
});
