import { THEMES, normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import { resolve } from "../src/resolve";
import { contrastRatio, getTheme, themeCss } from "../src/themes";

function resolved(input: unknown) {
  const { scenefile, diagnostics } = normalize(input);
  if (!scenefile) throw new Error(JSON.stringify(diagnostics));
  return resolve(scenefile);
}

const scenes = [{ type: "title", heading: "one two three", sub: "four five six" }];

describe("themes", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#123456", "#123456")).toBe(1);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(contrastRatio("#000000", "#FFFFFF"));
  });

  it("makes signal the default: pure black with an acid lime accent", () => {
    const { video } = resolved({ version: 1, scenes });
    expect(video.theme).toBe("signal");
    expect(getTheme("signal")).toMatchObject({ background: "#000000", accent: "#C8FF00", headingWeight: 900 });
    const css = themeCss("signal", undefined, 1920, 1080);
    expect(css).toContain("--sf-bg:#000000");
    expect(css).toContain("--sf-accent:#C8FF00");
    expect(css).toContain("--sf-heading-weight:900");
    expect(css).toContain('--sf-font-sans:"Onest"');
    expect(css).toContain('--sf-font-mono:"Cascadia Code"');
  });

  it("keeps every theme's own colors readable", () => {
    for (const name of ["signal", "midnight"] as const) {
      const theme = getTheme(name);
      expect(contrastRatio(theme.text, theme.background)).toBeGreaterThan(7);
      expect(contrastRatio(theme.muted, theme.background)).toBeGreaterThan(4.5);
      expect(contrastRatio(theme.accent, theme.background)).toBeGreaterThan(4.5);
    }
  });

  it("rejects an accent that cannot be read on the theme background", () => {
    const { diagnostics } = resolved({ version: 1, accent: "#1A1A1A", scenes });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "CONTRAST_LOW", severity: "error", path: "accent" }),
    ]);
    expect(diagnostics[0]?.message).toMatch(/1\.\d:1/);
    expect(resolved({ version: 1, accent: "#FF5722", scenes }).diagnostics).toEqual([]);
  });

  it("gives each scene its position and includes the shared chrome styles once", () => {
    const { video } = resolved({ version: 1, scenes: [...scenes, { type: "terminal", steps: [{ run: "ls" }] }] });
    const { html } = compile(video);
    expect(html.match(/<div class="sf-chrome">/g)).toHaveLength(1);
    expect(html).toContain("<b>01</b> / 02");
    expect(html.match(/\.sf-chrome\{/g)).toHaveLength(1);
    expect(html.match(/class="sf-wipe"/g)).toHaveLength(1);
    expect(html).toContain('data-sf-path="scenes[1].steps"');
  });
});

describe("every theme can be read", () => {
  it.each([...THEMES])("%s keeps its text, quiet text and accent clear of the background", (name) => {
    const theme = getTheme(name);
    expect(contrastRatio(theme.text, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(theme.muted, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.accent, theme.background)).toBeGreaterThanOrEqual(3);
    // The accent has to read as a different color from the text, not as the text.
    expect(theme.accent.toLowerCase()).not.toBe(theme.text.toLowerCase());
  });

  it("offers looks that are not dark", () => {
    expect([...THEMES]).toEqual(expect.arrayContaining(["signal", "midnight", "paper", "cobalt", "solar"]));
    expect(getTheme("paper").background).toBe("#FFFFFF");
    const light = [...THEMES].filter((name) => contrastRatio(getTheme(name).background, "#000000") > 4);
    // White and yellow are light; blue is a color, neither light nor black.
    expect(light).toEqual(["paper", "solar", "mint", "studio"]);
    expect(getTheme("cobalt").background).not.toMatch(/^#0[0-9A-F]0[0-9A-F]0[0-9A-F]$/i);
  });
});

describe("themes with a voice of their own", () => {
  it("offers at least ten, in more than one typeface", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10);
    expect([...THEMES]).toEqual(expect.arrayContaining(["terminal", "ink", "mint", "studio", "forest"]));
    const displays = new Set([...THEMES].map((name) => getTheme(name).fontDisplay));
    expect(displays.size).toBeGreaterThanOrEqual(4);
  });

  it("sets headings in the theme's display face, falling back to its text face", () => {
    const css = themeCss("ink", undefined, 1920, 1080);
    expect(css).toContain('--sf-font-display:"Unbounded","Onest",sans-serif');
    expect(themeCss("terminal", undefined, 1920, 1080)).toContain('--sf-font-display:"Cascadia Code"');
    expect(themeCss("signal", undefined, 1920, 1080)).toContain('--sf-font-display:"Onest",sans-serif');
  });

  it("embeds the display face only for themes that use one", () => {
    const html = (theme: string) => compile(resolved({ version: 1, theme, scenes }).video).html;
    expect(html("ink")).toContain('font-family:"Unbounded"');
    expect(html("ink")).toMatch(/\.sf-title__heading\{[^}]*var\(--sf-font-display\)/);
    expect(html("signal")).not.toContain('font-family:"Unbounded"');
    expect(html("studio")).toContain('font-family:"Geologica"');
  });
});
