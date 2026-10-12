import { clamp01, easeOutCubic, fadeExit, reveal } from "../motion";
import type { SceneMount } from "../types";
import { AFTER_DELAY_SECONDS, RECEDED, SIDE_FADE_SECONDS } from "./timing";

export const mountCompare: SceneMount = (el, ctx) => {
  const [before, after] = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-side]"));
  const fade = SIDE_FADE_SECONDS * ctx.fps;
  const afterStart = ctx.enterFrames + AFTER_DELAY_SECONDS * ctx.fps;
  return {
    seek(frame) {
      fadeExit(el, ctx, frame);
      if (!before || !after) return;
      reveal(before, frame, 0, ctx.enterFrames);
      reveal(after, frame, afterStart, fade);
      // Once the after side is in, the before side steps back so the eye goes to what changed.
      const arrived = easeOutCubic(clamp01((frame - afterStart) / fade));
      before.style.opacity = String(Number(before.style.opacity) * (1 - arrived * (1 - RECEDED)));
    },
  };
};
