import type { MountContext } from "./types";

const STAGGER_FRAMES = 4;
const ENTER_OFFSET_PX = 40;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number): number {
  return t ** 3;
}

/** Fades and lifts every [data-sf-enter] element in, in the order its value gives. */
export function staggerEnter(el: HTMLElement, ctx: MountContext, frame: number): void {
  for (const item of el.querySelectorAll<HTMLElement>("[data-sf-enter]")) {
    const start = Number(item.dataset.sfEnter) * STAGGER_FRAMES;
    const t = easeOutCubic(clamp01((frame - start) / ctx.enterFrames));
    item.style.opacity = String(t);
    item.style.transform = `translateY(${(1 - t) * ENTER_OFFSET_PX}px)`;
  }
}

/** Fades the whole scene out over its last `exitFrames` frames. */
export function fadeExit(el: HTMLElement, ctx: MountContext, frame: number): void {
  const start = ctx.durationFrames - ctx.exitFrames;
  const t = easeInCubic(clamp01((frame - start) / ctx.exitFrames));
  el.style.opacity = String(1 - t);
}
