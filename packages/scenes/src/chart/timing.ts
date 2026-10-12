/** Seconds between one bar starting to grow and the next. */
export const BAR_STAGGER_SECONDS = 0.18;
/** Seconds a bar takes to reach its length. */
export const BAR_GROW_SECONDS = 0.7;

/** Seconds after the scene has entered until the last bar is at full length. */
export function chartRevealSeconds(bars: number): number {
  return Math.max(0, bars - 1) * BAR_STAGGER_SECONDS + BAR_GROW_SECONDS;
}
