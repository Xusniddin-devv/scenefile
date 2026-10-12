import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/check";
import { fontCovers, fontFaceCss, loadFont } from "../src/fonts";

const cp = (char: string): number => char.codePointAt(0) ?? 0;

describe("bundled fonts", () => {
  it.each(["onest", "cascadiaCode"] as const)("%s ships Latin and Cyrillic files", (key) => {
    const font = loadFont(key);
    const names = font.subsets.map((subset) => subset.name);
    expect(names).toEqual(expect.arrayContaining(["latin", "latin-ext", "cyrillic"]));
    for (const subset of font.subsets) expect(existsSync(subset.file), subset.file).toBe(true);
  });

  it("judges coverage by the glyphs in the font files, not by the ranges the package declares", () => {
    const sans = loadFont("onest");
    const mono = loadFont("cascadiaCode");
    // Russian, Uzbek Cyrillic and Uzbek Latin must work in both.
    for (const char of "AéЖяўқҳғЎҚҲҒʻ₽") {
      expect(fontCovers(sans, cp(char)), `sans ${char}`).toBe(true);
      expect(fontCovers(mono, cp(char)), `mono ${char}`).toBe(true);
    }
    for (const char of "日ع한") expect(fontCovers(sans, cp(char)), char).toBe(false);
    // Inside a declared range, but the file has no glyph for it.
    for (const char of ["\u20DD", "₩", "∞", "✗"]) expect(fontCovers(sans, cp(char)), char).toBe(false);
    // The mono font draws tree output, but not arrows or ticks.
    for (const char of "│─└├") expect(fontCovers(mono, cp(char)), char).toBe(true);
    for (const char of "→✓") expect(fontCovers(mono, cp(char)), char).toBe(false);
    // Control characters are never "covered".
    expect(fontCovers(sans, 0x1b)).toBe(false);
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
    expect(result.diagnostics[0]?.message).toContain("日 (U+65E5), 本 (U+672C), 語 (U+8A9E)");
    expect(result.diagnostics[0]?.message).toContain("Onest");
    expect(result.diagnostics[0]?.fix).toMatch(/Latin or Cyrillic/);
  });

  const withOutput = (run: string, output: string) =>
    check({ version: 1, scenes: [{ type: "terminal", steps: [{ run, output }, { run: "echo done please now" }] }] });

  it("accepts Uzbek and Russian in terminal text, and tree-drawing characters", () => {
    expect(withOutput("echo қишлоқ ҳаёти ғоя oʻzbek", "Привет ўзбек").diagnostics).toEqual([]);
    expect(withOutput("tree", "├── src\n│   └── index.ts").diagnostics).toEqual([]);
  });

  it("rejects symbols the font lacks and suggests plain replacements", () => {
    const result = withOutput("npm test", "✓ built → next");
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "GLYPH_MISSING", path: "scenes[0].steps[0].output" }),
    ]);
    expect(result.diagnostics[0]?.message).toContain("✓ (U+2713), → (U+2192)");
    expect(result.diagnostics[0]?.fix).toContain("->");
    expect(result.diagnostics[0]?.fix).not.toMatch(/Cyrillic/);
  });

  it("rejects a combining mark the font cannot draw instead of letting a box through", () => {
    const result = withTitle("Hi\u20DD there");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GLYPH_MISSING"]);
    expect(result.diagnostics[0]?.message).toContain("U+20DD");
  });

  it("does not call a symbol an emoji when the font can draw it", () => {
    expect(withTitle("Brand™ ©2026").diagnostics).toEqual([]);
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
    expect(html).toContain('font-family:"Cascadia Code"');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.length).toBeLessThan(600_000);
  });
});
