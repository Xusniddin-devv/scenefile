import type { MountContext } from "./types";

/** Delay between one staggered element and the next. */
export const STAGGER_SECONDS = 4 / 30;
const ENTER_OFFSET_PX = 40;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number): number {
  return t ** 3;
}

/** Fades and lifts one element in over `frames` frames, beginning at frame `start`. */
export function reveal(
  item: HTMLElement,
  frame: number,
  start: number,
  frames: number,
  offsetPx: number = ENTER_OFFSET_PX,
): void {
  const t = easeOutCubic(clamp01((frame - start) / frames));
  item.style.opacity = String(t);
  item.style.transform = `translateY(${(1 - t) * offsetPx}px)`;
}

/** Reveals every [data-sf-enter] element, in the order its value gives. */
export function staggerEnter(el: HTMLElement, ctx: MountContext, frame: number): void {
  for (const item of el.querySelectorAll<HTMLElement>("[data-sf-enter]")) {
    reveal(item, frame, Number(item.dataset.sfEnter) * STAGGER_SECONDS * ctx.fps, ctx.enterFrames);
  }
}

/** Fades the whole scene out over its last `exitFrames` frames. */
export function fadeExit(el: HTMLElement, ctx: MountContext, frame: number): void {
  // With no exit of its own (a transition takes the scene away) it stays fully drawn.
  if (ctx.exitFrames <= 0) {
    el.style.opacity = "1";
    return;
  }
  const start = ctx.durationFrames - ctx.exitFrames;
  const t = easeInCubic(clamp01((frame - start) / ctx.exitFrames));
  el.style.opacity = String(1 - t);
}
