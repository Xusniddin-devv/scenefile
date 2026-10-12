import { mountBullets } from "./bullets/mount";
import { mountChart } from "./chart/mount";
import { mountClip } from "./clip/mount";
import { mountCode } from "./code/mount";
import { mountCompare } from "./compare/mount";
import { mountOutro } from "./outro/mount";
import { mountQuote } from "./quote/mount";
import { mountScreenshot } from "./screenshot/mount";
import { mountStat } from "./stat/mount";
import { mountStatement } from "./statement/mount";
import { mountTerminal } from "./terminal/mount";
import { mountTitle } from "./title/mount";
import type { SceneMount } from "./types";

/** Browser-side registry. Must not import zod or shiki: this file is bundled into the page. */
export const mounts: Record<string, SceneMount> = {
  title: mountTitle,
  statement: mountStatement,
  quote: mountQuote,
  bullets: mountBullets,
  stat: mountStat,
  code: mountCode,
  outro: mountOutro,
  screenshot: mountScreenshot,
  compare: mountCompare,
  chart: mountChart,
  clip: mountClip,
  terminal: mountTerminal,
};

export type { MountContext, SceneHandle, SceneMount } from "./types";
