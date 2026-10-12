import { mountQuote } from "./quote/mount";
import { mountStatement } from "./statement/mount";
import { mountTerminal } from "./terminal/mount";
import { mountTitle } from "./title/mount";
import type { SceneMount } from "./types";

/** Browser-side registry. Must not import zod or shiki: this file is bundled into the page. */
export const mounts: Record<string, SceneMount> = {
  title: mountTitle,
  statement: mountStatement,
  quote: mountQuote,
  terminal: mountTerminal,
};

export type { MountContext, SceneHandle, SceneMount } from "./types";
