export const WORD_STAGGER_SECONDS = 0.07;
export const WORD_FADE_SECONDS = 0.35;

/** Seconds from the first word starting to appear until the last is fully visible. */
export function statementRevealSeconds(words: number): number {
  return Math.max(0, words - 1) * WORD_STAGGER_SECONDS + WORD_FADE_SECONDS;
}
