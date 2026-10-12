import { clamp01, easeOutCubic, fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { COUNT_SECONDS, statText } from "./timing";

export const mountStat: SceneMount = (el, ctx) => {
  const value = el.querySelector<HTMLElement>("[data-sf-value]");
  const full = value?.dataset.sfValue ?? "";
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      if (!value) return;
      const progress = clamp01((frame - ctx.enterFrames) / (COUNT_SECONDS * ctx.fps));
      value.textContent = statText(full, progress >= 1 ? 1 : easeOutCubic(progress));
    },
  };
};
