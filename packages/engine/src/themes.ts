import type { ThemeName } from "@scenefile/schema";

export interface Theme {
  background: string;
  surface: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  fontSans: string;
  fontMono: string;
}

/** Neutral greys only: no hue tint in the darks. */
const THEME_TOKENS: Record<ThemeName, Theme> = {
  midnight: {
    background: "#0A0A0A",
    surface: "#141414",
    line: "#2A2A2A",
    text: "#F4F4F4",
    muted: "#8C8C8C",
    accent: "#FF5A1F",
    fontSans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    fontMono: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
  },
};

/** CSS custom properties for a theme. `--sf-unit` is 1% of the short side of the frame. */
export function themeCss(name: ThemeName, accent: string | undefined, width: number, height: number): string {
  const theme = THEME_TOKENS[name];
  return [
    ":root{",
    `--sf-bg:${theme.background};`,
    `--sf-surface:${theme.surface};`,
    `--sf-line:${theme.line};`,
    `--sf-text:${theme.text};`,
    `--sf-muted:${theme.muted};`,
    `--sf-accent:${accent ?? theme.accent};`,
    `--sf-font-sans:${theme.fontSans};`,
    `--sf-font-mono:${theme.fontMono};`,
    `--sf-unit:${Math.min(width, height) / 100}px`,
    "}",
  ].join("");
}
