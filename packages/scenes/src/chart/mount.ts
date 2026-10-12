import { clamp01, easeOutCubic, fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { BAR_GROW_SECONDS, BAR_STAGGER_SECONDS } from "./timing";

export const mountChart: SceneMount = (el, ctx) => {
  const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-bar]"));
  const fills = rows.map((row) => row.querySelector<HTMLElement>(".sf-chart__fill"));
  const values = rows.map((row) => row.querySelector<HTMLElement>(".sf-chart__value"));
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      const seconds = (frame - ctx.enterFrames) / ctx.fps;
      rows.forEach((_, i) => {
        const grown = easeOutCubic(clamp01((seconds - i * BAR_STAGGER_SECONDS) / BAR_GROW_SECONDS));
        const fill = fills[i];
        const value = values[i];
        if (fill) fill.style.transform = `scaleX(${grown})`;
        // The number arrives with the end of its bar, not before there is anything to read it against.
        if (value) value.style.opacity = String(clamp01(grown * 2 - 1));
      });
    },
  };
};
