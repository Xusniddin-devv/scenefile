import { clamp01, easeOutCubic, fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { ITEM_FADE_SECONDS, bulletSchedule } from "./timing";

/** How visible an item is before its turn. */
const DIM = 0.24;

export const mountBullets: SceneMount = (el, ctx) => {
  const items = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-item]"));
  const starts = bulletSchedule(items.map((item) => item.querySelector("span")?.textContent ?? ""));
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      const seconds = (frame - ctx.enterFrames) / ctx.fps;
      items.forEach((item, i) => {
        const lit = easeOutCubic(clamp01((seconds - (starts[i] ?? 0)) / ITEM_FADE_SECONDS));
        item.style.opacity = String(1 - (1 - DIM) * (1 - lit));
      });
    },
  };
};
