import { fadeExit, reveal } from "../motion";
import type { SceneMount } from "../types";
import { WORD_FADE_SECONDS, WORD_STAGGER_SECONDS } from "./timing";

const WORD_OFFSET_PX = 28;

export const mountStatement: SceneMount = (el, ctx) => {
  const words = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-word]"));
  const stagger = WORD_STAGGER_SECONDS * ctx.fps;
  const fade = WORD_FADE_SECONDS * ctx.fps;
  return {
    seek(frame) {
      words.forEach((word, i) => reveal(word, frame, ctx.enterFrames + i * stagger, fade, WORD_OFFSET_PX));
      fadeExit(el, ctx, frame);
    },
  };
};
