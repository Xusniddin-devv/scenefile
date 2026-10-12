import type { ThemeName } from "@scenefile/schema";

export type FontKey = "onest" | "cascadiaCode";

/** CSS family name for each bundled font. */
export const FONT_FAMILIES: Record<FontKey, string> = {
  onest: "Onest",
  cascadiaCode: "Cascadia Code",
};

export interface Theme {
  background: string;
  surface: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  fontSans: FontKey;
  fontMono: FontKey;
  headingWeight: number;
  headingTracking: string;
}

/** Neutral greys only in the dark and white themes: no hue tint. The color themes are one flat color. */
const THEME_TOKENS: Record<ThemeName, Theme> = {
  signal: {
    background: "#000000",
    surface: "#0D0D0D",
    line: "#2B2B2B",
    text: "#F2F2F2",
    muted: "#9A9A9A",
    accent: "#C8FF00",
    fontSans: "onest",
    fontMono: "cascadiaCode",
    headingWeight: 900,
    headingTracking: "-0.035em",
  },
  midnight: {
    background: "#0A0A0A",
    surface: "#141414",
    line: "#2A2A2A",
    text: "#F4F4F4",
    muted: "#8C8C8C",
    accent: "#FF5A1F",
    fontSans: "onest",
    fontMono: "cascadiaCode",
    headingWeight: 800,
    headingTracking: "-0.04em",
  },
  // Pure white, black type, one hot accent.
  paper: {
    background: "#FFFFFF",
    surface: "#F0F0F0",
    line: "#D4D4D4",
    text: "#0A0A0A",
    muted: "#5C5C5C",
    accent: "#E63200",
    fontSans: "onest",
    fontMono: "cascadiaCode",
    headingWeight: 900,
    headingTracking: "-0.035em",
  },
  // A flat field of blue with white type and a yellow accent.
  cobalt: {
    background: "#1433E6",
    surface: "#0F28C4",
    line: "#4C63F2",
    text: "#FFFFFF",
    muted: "#C7D0FF",
    accent: "#FFE500",
    fontSans: "onest",
    fontMono: "cascadiaCode",
    headingWeight: 900,
    headingTracking: "-0.035em",
  },
  // A flat field of yellow with black type and a blue accent.
  solar: {
    background: "#FFE500",
    surface: "#F2D900",
    line: "#BFA900",
    text: "#0A0A0A",
    muted: "#5C5200",
    accent: "#1433E6",
    fontSans: "onest",
    fontMono: "cascadiaCode",
    headingWeight: 900,
    headingTracking: "-0.035em",
  },
};

export function getTheme(name: ThemeName): Theme {
  return THEME_TOKENS[name];
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two `#RRGGBB` colors, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** CSS custom properties for a theme. `--sf-unit` is 1% of the short side of the frame. */
export function themeCss(name: ThemeName, accent: string | undefined, width: number, height: number): string {
  const theme = getTheme(name);
  return [
    ":root{",
    `--sf-bg:${theme.background};`,
    `--sf-surface:${theme.surface};`,
    `--sf-line:${theme.line};`,
    `--sf-text:${theme.text};`,
    `--sf-muted:${theme.muted};`,
    `--sf-accent:${accent ?? theme.accent};`,
    `--sf-font-sans:"${FONT_FAMILIES[theme.fontSans]}",sans-serif;`,
    `--sf-font-mono:"${FONT_FAMILIES[theme.fontMono]}",monospace;`,
    `--sf-heading-weight:${theme.headingWeight};`,
    `--sf-heading-tracking:${theme.headingTracking};`,
    `--sf-unit:${Math.min(width, height) / 100}px`,
    "}",
  ].join("");
}
