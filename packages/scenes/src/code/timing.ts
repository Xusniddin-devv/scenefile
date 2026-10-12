import { readingSeconds } from "../text";

export const LINE_STAGGER_SECONDS = 0.06;
export const LINE_FADE_SECONDS = 0.3;
/** Pause between the last line appearing and the unmarked lines dimming. */
export const FOCUS_DELAY_SECONDS = 0.3;
export const FOCUS_FADE_SECONDS = 0.4;
const READ_SECONDS_PER_LINE = 0.55;

/** Seconds from the first line starting to appear until the last is fully visible. */
export function codeRevealSeconds(lines: number): number {
  return Math.max(0, lines - 1) * LINE_STAGGER_SECONDS + LINE_FADE_SECONDS;
}

/** With marked lines, only those need reading; otherwise all of them do. */
export function codeHoldSeconds(lines: number, marked: number, caption: string | undefined): number {
  const focus = marked > 0 ? FOCUS_DELAY_SECONDS + FOCUS_FADE_SECONDS : 0;
  const read = (marked > 0 ? marked : lines) * READ_SECONDS_PER_LINE;
  return codeRevealSeconds(lines) + focus + read + readingSeconds(caption ?? "");
}
