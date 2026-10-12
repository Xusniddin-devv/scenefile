import { fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";

export const mountQuote: SceneMount = (el, ctx) => ({
  seek(frame) {
    staggerEnter(el, ctx, frame);
    fadeExit(el, ctx, frame);
  },
});
