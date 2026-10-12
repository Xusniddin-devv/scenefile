import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type Diagnostic, error, warning } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import { woff2CodePoints } from "./cmap";
import type { ResolvedVideo } from "./resolve";
import { FONT_FAMILIES, type FontKey, getTheme } from "./themes";

const require = createRequire(import.meta.url);

/**
 * Where each bundled font comes from. All are SIL Open Font License 1.1.
 * Versions are pinned exactly in package.json: a different build of a font has
 * different metrics, which would change how text fits and so change the frames.
 *
 * Cascadia Code is the monospace font because, unlike most, it has the letters
 * Uzbek and Tajik add to Cyrillic, the Uzbek Latin apostrophe, and the
 * box-drawing characters that tree-style command output uses.
 */
const SOURCES: Record<FontKey, { pkg: string; slug: string; weight: string }> = {
  onest: { pkg: "@fontsource-variable/onest", slug: "onest", weight: "100 900" },
  cascadiaCode: { pkg: "@fontsource-variable/cascadia-code", slug: "cascadia-code", weight: "200 700" },
};

export interface FontSubset {
  name: string;
  /** CSS `unicode-range` value. */
  unicodeRange: string;
  ranges: [number, number][];
  file: string;
  /** Code points this subset really draws: inside its range and present in the file. */
  glyphs: Set<number>;
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

function readSubsets(source: { pkg: string; slug: string }): FontSubset[] {
  const anchor = require.resolve(`${source.pkg}/files/${source.slug}-latin-wght-normal.woff2`);
  const root = dirname(dirname(anchor));
  const unicode = JSON.parse(readFileSync(join(root, "unicode.json"), "utf8")) as Record<string, string>;
  return Object.entries(unicode).map(([name, unicodeRange]) => {
    const file = join(root, "files", `${source.slug}-${name}-wght-normal.woff2`);
    const ranges = parseRanges(unicodeRange);
    // The browser uses a face only for characters in its unicode-range, and can
    // only draw those the file has a glyph for; coverage is the intersection.
    const glyphs = new Set<number>();
    for (const cp of woff2CodePoints(readFileSync(file))) {
      if (ranges.some(([from, to]) => cp >= from && cp <= to)) glyphs.add(cp);
    }
    return { name, unicodeRange, ranges, file, glyphs };
  });
}

/** Reads a bundled font: its subsets and the characters each one really draws. */
export function loadFont(key: FontKey): LoadedFont {
  const cached = cache.get(key);
  if (cached) return cached;
  const source = SOURCES[key];
  let subsets: FontSubset[];
  try {
    subsets = readSubsets(source);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `scenefile could not read its bundled font ${FONT_FAMILIES[key]} (${source.pkg}): ${reason}. Reinstall scenefile.`,
    );
  }
  const font = { family: FONT_FAMILIES[key], weight: source.weight, subsets };
  cache.set(key, font);
  return font;
}

/** True when the font, as embedded, can draw this character. */
export function fontCovers(font: LoadedFont, codePoint: number): boolean {
  return font.subsets.some((subset) => subset.glyphs.has(codePoint));
}

/**
 * `@font-face` rules, with the font data inline, for the subsets `text` uses.
 * Latin is always included: scene chrome and punctuation need it.
 */
export function fontFaceCss(key: FontKey, text: string): string {
  const font = loadFont(key);
  const codePoints = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  return font.subsets
    .filter((subset) => subset.name === "latin" || codePoints.some((cp) => subset.glyphs.has(cp)))
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

function codePointName(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
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
      // Coverage first: a symbol the font draws is not an emoji problem.
      if (fontCovers(font, char.codePointAt(0) ?? 0)) continue;
      if (EMOJI.test(char)) emoji = true;
      else missing.add(char);
    }
    if (missing.size > 0) {
      const named = [...missing].map((char) => `${char} (${codePointName(char)})`).join(", ");
      const letters = [...missing].some((char) => /[\p{L}\p{M}]/u.test(char));
      diagnostics.push(
        error(
          "GLYPH_MISSING",
          entry.path,
          `The ${font.family} font cannot draw: ${named}`,
          letters
            ? "Write this text in Latin or Cyrillic letters, or remove these characters."
            : 'Replace these symbols with plain characters, for example "->" for an arrow, "v" or "x" for a tick or cross, "*" for a bullet.',
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
