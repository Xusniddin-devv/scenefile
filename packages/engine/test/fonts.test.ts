import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/check";
import { fontCovers, fontFaceCss, loadFont } from "../src/fonts";

const cp = (char: string): number => char.codePointAt(0) ?? 0;

describe("bundled fonts", () => {
  it.each(["onest", "jetbrainsMono"] as const)("%s ships Latin and Cyrillic files", (key) => {
    const font = loadFont(key);
    const names = font.subsets.map((subset) => subset.name);
    expect(names).toEqual(expect.arrayContaining(["latin", "latin-ext", "cyrillic"]));
    for (const subset of font.subsets) expect(existsSync(subset.file), subset.file).toBe(true);
  });

  it("covers Latin, Cyrillic and Uzbek Latin, but not CJK", () => {
    const font = loadFont("onest");
    for (const char of ["A", "é", "Ж", "ў", "ʻ", "₽"]) expect(fontCovers(font, cp(char)), char).toBe(true);
    for (const char of ["日", "ع", "한"]) expect(fontCovers(font, cp(char)), char).toBe(false);
  });

  it("embeds only the subsets the text needs, with Latin always present", () => {
    const latin = fontFaceCss("onest", "Hello");
    expect(latin.match(/@font-face/g)).toHaveLength(1);
    expect(latin).toContain('font-family:"Onest"');
    expect(latin).toContain("src:url(data:font/woff2;base64,");
    expect(latin).toContain("unicode-range:");

    const mixed = fontFaceCss("onest", "Привет");
    expect(mixed.match(/@font-face/g)).toHaveLength(2);
    expect(fontFaceCss("onest", "").match(/@font-face/g)).toHaveLength(1);
  });
});

describe("glyph checks in check()", () => {
  const withTitle = (heading: string) =>
    check({ version: 1, scenes: [{ type: "title", heading, sub: "one two three four five six" }] });

  it("accepts Cyrillic and Uzbek Latin without diagnostics", () => {
    expect(withTitle("Привет, дунё").diagnostics).toEqual([]);
    expect(withTitle("Oʻzbekiston").diagnostics).toEqual([]);
  });

  it("rejects text the theme font cannot draw, naming the characters once each", () => {
    const result = withTitle("日本語 video 日");
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "GLYPH_MISSING", severity: "error", path: "scenes[0].heading" }),
    ]);
    expect(result.diagnostics[0]?.message).toContain("日 本 語");
    expect(result.diagnostics[0]?.message).toContain("Onest");
  });

  it("warns, without failing, when text contains emoji", () => {
    const result = check({
      version: 1,
      scenes: [{ type: "terminal", steps: [{ run: "🚀 deploy 🇺🇿", output: "ok" }, { run: "echo done please now" }] }],
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "GLYPH_FALLBACK", severity: "warning", path: "scenes[0].steps[0].run" }),
    ]);
  });

  it("embeds the fonts in the composition and references nothing remote", () => {
    const { composition } = withTitle("Привет");
    const html = composition?.html ?? "";
    expect(html).toContain('font-family:"Onest"');
    expect(html).toContain('font-family:"JetBrains Mono"');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.length).toBeLessThan(600_000);
  });
});
