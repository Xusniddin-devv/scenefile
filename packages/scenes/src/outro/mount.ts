import { fadeExit, staggerEnter } from "../motion";
import { graphemes, terminalSchedule, typedLength } from "../terminal/timing";
import type { SceneMount } from "../types";
import { TYPE_DELAY_SECONDS } from "./timing";

export const mountOutro: SceneMount = (el, ctx) => {
  const typed = el.querySelector<HTMLElement>("[data-sf-type]");
  const chars = graphemes(typed?.dataset.sfType ?? "");
  const [timing] = terminalSchedule([{ run: chars.join("") }]);
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      if (!typed || !timing) return;
      const seconds = (frame - ctx.enterFrames) / ctx.fps - TYPE_DELAY_SECONDS;
      typed.textContent = chars.slice(0, typedLength(chars.length, timing, seconds)).join("");
    },
  };
};
