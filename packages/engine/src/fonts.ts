import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type Diagnostic, error, warning } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import type { ResolvedVideo } from "./resolve";
import { FONT_FAMILIES, type FontKey, getTheme } from "./themes";

const require = createRequire(import.meta.url);

/** Where each bundled font comes from. All are SIL Open Font License 1.1. */
const SOURCES: Record<FontKey, { pkg: string; slug: string; weight: string }> = {
  onest: { pkg: "@fontsource-variable/onest", slug: "onest", weight: "100 900" },
  jetbrainsMono: { pkg: "@fontsource-variable/jetbrains-mono", slug: "jetbrains-mono", weight: "100 800" },
};

export interface FontSubset {
  name: string;
  /** CSS `unicode-range` value. */
  unicodeRange: string;
  ranges: [number, number][];
  file: string;
}

export interface LoadedFont {
  family: string;
  weight: string;
  subsets: FontSubset[];
}

const cache = new Map<FontKey, LoadedFont>();

function parseRanges(unicodeRange: string): [number, number][] {
  return unicodeRange.split(",").map((part): [number, number] => {
    const [from = "", to] = part.trim().replace(/^U\+/i, "").split("-");
    const start = Number.parseInt(from, 16);
    return [start, to === undefined ? start : Number.parseInt(to, 16)];
  });
}

/** Reads a bundled font's subset table. The font files themselves are read only when embedded. */
export function loadFont(key: FontKey): LoadedFont {
  const cached = cache.get(key);
  if (cached) return cached;
  const source = SOURCES[key];
  const anchor = require.resolve(`${source.pkg}/files/${source.slug}-latin-wght-normal.woff2`);
  const root = dirname(dirname(anchor));
  const unicode = JSON.parse(readFileSync(join(root, "unicode.json"), "utf8")) as Record<string, string>;
  const subsets = Object.entries(unicode).map(([name, unicodeRange]) => ({
    name,
    unicodeRange,
    ranges: parseRanges(unicodeRange),
    file: join(root, "files", `${source.slug}-${name}-wght-normal.woff2`),
  }));
  const font = { family: FONT_FAMILIES[key], weight: source.weight, subsets };
  cache.set(key, font);
  return font;
}

function subsetCovers(subset: FontSubset, codePoint: number): boolean {
  return subset.ranges.some(([from, to]) => codePoint >= from && codePoint <= to);
}

export function fontCovers(font: LoadedFont, codePoint: number): boolean {
  return font.subsets.some((subset) => subsetCovers(subset, codePoint));
}

/**
 * `@font-face` rules, with the font data inline, for the subsets `text` uses.
 * Latin is always included: scene chrome and punctuation need it.
 */
export function fontFaceCss(key: FontKey, text: string): string {
  const font = loadFont(key);
  const codePoints = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  return font.subsets
    .filter((subset) => subset.name === "latin" || codePoints.some((cp) => subsetCovers(subset, cp)))
    .map((subset) => {
      const data = readFileSync(subset.file).toString("base64");
      return `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${subset.unicodeRange}}`;
    })
    .join("\n");
}

/** Every string the video draws, with its full scenefile path. */
export function videoTexts(video: ResolvedVideo): { path: string; text: string; font: "sans" | "mono" }[] {
  return video.scenes.flatMap((scene) =>
    getScene(scene.type)
      .texts(scene.props)
      .map((entry) => ({ ...entry, path: `scenes[${scene.index}].${entry.path}` })),
  );
}

/** Emoji and the invisible characters that join or style them. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[‍️⃣]/u;

/**
 * Finds text the theme's fonts cannot draw. Without this the browser would
 * substitute whatever font the machine has, or draw empty boxes.
 */
export function glyphDiagnostics(video: ResolvedVideo): Diagnostic[] {
  const theme = getTheme(video.theme);
  const diagnostics: Diagnostic[] = [];
  for (const entry of videoTexts(video)) {
    const font = loadFont(entry.font === "sans" ? theme.fontSans : theme.fontMono);
    const missing = new Set<string>();
    let emoji = false;
    for (const char of entry.text) {
      if (/\s/u.test(char)) continue;
      if (EMOJI.test(char)) emoji = true;
      else if (!fontCovers(font, char.codePointAt(0) ?? 0)) missing.add(char);
    }
    if (missing.size > 0) {
      diagnostics.push(
        error(
          "GLYPH_MISSING",
          entry.path,
          `The ${font.family} font cannot draw: ${[...missing].join(" ")}`,
          "Write this text in Latin or Cyrillic script, or remove these characters.",
        ),
      );
    }
    if (emoji) {
      diagnostics.push(
        warning(
          "GLYPH_FALLBACK",
          entry.path,
          "Emoji are drawn with the computer's own emoji font, so they look different on each machine.",
          "Remove the emoji if the video must look identical everywhere.",
        ),
      );
    }
  }
  return diagnostics;
}
