/** Seconds after the scene has entered before the first callout appears. */
export const PIN_START_SECONDS = 0.6;
export const PIN_GAP_SECONDS = 0.9;
export const PIN_FADE_SECONDS = 0.35;
/** How far the view moves in on the image over the whole scene. */
export const ZOOM = 0.04;

/** Seconds, after entering, until the last callout is fully shown. */
export function pinsRevealSeconds(count: number): number {
  return count === 0 ? 0 : PIN_START_SECONDS + (count - 1) * PIN_GAP_SECONDS + PIN_FADE_SECONDS;
}
