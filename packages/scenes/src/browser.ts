import { mountTerminal } from "./terminal/mount";
import { mountTitle } from "./title/mount";
import type { SceneMount } from "./types";

/** Browser-side registry. Must not import zod: this file is bundled into the page. */
export const mounts: Record<string, SceneMount> = {
  title: mountTitle,
  terminal: mountTerminal,
};

export type { MountContext, SceneHandle, SceneMount } from "./types";
