import { clamp01, easeOutCubic, fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import {
  FOCUS_DELAY_SECONDS,
  FOCUS_FADE_SECONDS,
  LINE_FADE_SECONDS,
  LINE_STAGGER_SECONDS,
  codeRevealSeconds,
} from "./timing";

/** How visible an unmarked line stays once attention moves to the marked ones. */
const UNFOCUSED = 0.38;

export const mountCode: SceneMount = (el, ctx) => {
  const lines = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-line]"));
  const marked = lines.map((line) => line.classList.contains("is-marked"));
  const focusAt = codeRevealSeconds(lines.length) + FOCUS_DELAY_SECONDS;
  const hasFocus = marked.includes(true);
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      const seconds = (frame - ctx.enterFrames) / ctx.fps;
      const focus = hasFocus ? easeOutCubic(clamp01((seconds - focusAt) / FOCUS_FADE_SECONDS)) : 0;
      lines.forEach((line, i) => {
        const shown = easeOutCubic(clamp01((seconds - i * LINE_STAGGER_SECONDS) / LINE_FADE_SECONDS));
        const level = marked[i] ? 1 : 1 - focus * (1 - UNFOCUSED);
        line.style.opacity = String(shown * level);
      });
    },
  };
};
