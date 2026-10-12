import type { SceneMount } from "../types";

/** The page only keeps the clip's place; the footage is laid in when the video is put together. */
export const mountClip: SceneMount = (el) => ({
  seek() {
    el.style.opacity = "1";
  },
});
