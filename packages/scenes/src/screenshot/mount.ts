import { clamp01, fadeExit, reveal, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { PIN_FADE_SECONDS, PIN_GAP_SECONDS, PIN_START_SECONDS, ZOOM } from "./timing";

const PIN_OFFSET_PX = 16;

export const mountScreenshot: SceneMount = (el, ctx) => {
  // The image and the callouts over it move in together, so each dot stays on what it points at.
  const layers = Array.from(el.querySelectorAll<HTMLElement>(".sf-shot__layer, .sf-shot__pins"));
  const pins = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-pin]"));
  const fade = PIN_FADE_SECONDS * ctx.fps;
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      // A slow, steady move in: an image that sits perfectly still reads as a slide.
      const progress = clamp01(frame / Math.max(1, ctx.durationFrames - 1));
      for (const layer of layers) layer.style.transform = `scale(${(1 + ZOOM * progress).toFixed(4)})`;
      pins.forEach((pin, i) => {
        const start = ctx.enterFrames + (PIN_START_SECONDS + i * PIN_GAP_SECONDS) * ctx.fps;
        reveal(pin, frame, start, fade, PIN_OFFSET_PX);
      });
    },
  };
};
