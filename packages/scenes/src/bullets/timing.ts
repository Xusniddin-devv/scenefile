import { readingSeconds } from "../text";

export const ITEM_FADE_SECONDS = 0.35;
/** Pause after an item has been read, before the next lights up. */
export const ITEM_GAP_SECONDS = 0.5;
export const TAIL_SECONDS = 0.4;

/** Seconds, from the start of the hold, at which each item lights up. */
export function bulletSchedule(items: readonly string[]): number[] {
  let cursor = 0;
  return items.map((item) => {
    const start = cursor;
    cursor += ITEM_GAP_SECONDS + readingSeconds(item);
    return start;
  });
}

export function bulletsHoldSeconds(items: readonly string[]): number {
  const lastStart = bulletSchedule(items).at(-1) ?? 0;
  return lastStart + ITEM_FADE_SECONDS + readingSeconds(items.at(-1) ?? "") + TAIL_SECONDS;
}
