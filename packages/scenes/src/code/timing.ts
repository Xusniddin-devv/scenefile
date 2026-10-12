import { readingSeconds } from "../text";

export const LINE_STAGGER_SECONDS = 0.06;
export const LINE_FADE_SECONDS = 0.3;
/** Pause between the last line appearing and the unmarked lines dimming. */
export const FOCUS_DELAY_SECONDS = 0.3;
export const FOCUS_FADE_SECONDS = 0.4;
const READ_SECONDS_PER_LINE = 0.55;
/** With lines marked: time to find them, to read each, and to glance at each line around them. */
const FOCUS_ORIENT_SECONDS = 1.2;
const READ_SECONDS_PER_MARKED_LINE = 0.8;
const GLANCE_SECONDS_PER_LINE = 0.12;

/** Seconds from the first line starting to appear until the last is fully visible. */
export function codeRevealSeconds(lines: number): number {
  return Math.max(0, lines - 1) * LINE_STAGGER_SECONDS + LINE_FADE_SECONDS;
}

/** Seconds until every line is shown and, if any are marked, the others have dimmed. */
export function codeSettledSeconds(lines: number, marked: number): number {
  return codeRevealSeconds(lines) + (marked > 0 ? FOCUS_DELAY_SECONDS + FOCUS_FADE_SECONDS : 0);
}

/**
 * With marked lines the viewer reads those and glances at the rest for
 * context; without, every line is read.
 */
export function codeHoldSeconds(lines: number, marked: number, caption: string | undefined): number {
  const read =
    marked > 0
      ? FOCUS_ORIENT_SECONDS + marked * READ_SECONDS_PER_MARKED_LINE + (lines - marked) * GLANCE_SECONDS_PER_LINE
      : lines * READ_SECONDS_PER_LINE;
  return codeSettledSeconds(lines, marked) + read + readingSeconds(caption ?? "");
}
