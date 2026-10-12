import type { Scenefile } from "@scenefile/schema";
import type { SceneType, TransitionKind } from "@scenefile/scenes";

/** How long two scenes share the frame in an overlapping transition. */
export const TRANSITION_SECONDS = 0.5;

const OVERLAPPING: ReadonlySet<TransitionKind> = new Set(["crossfade", "push", "wipe", "zoom"]);

/** True for kinds that draw the old and the new scene at the same time. */
export function isOverlapping(kind: TransitionKind | "none"): boolean {
  return kind !== "none" && OVERLAPPING.has(kind);
}

/**
 * What suits arriving at each kind of scene, best first. Openers and closers
 * arrive out of black; dense scenes are wiped open; a single figure is zoomed
 * to; lists and sentences are pushed in like the next page.
 */
const PREFERRED: Record<SceneType, readonly TransitionKind[]> = {
  title: ["fade", "zoom"],
  outro: ["fade", "crossfade"],
  statement: ["push", "crossfade"],
  // A dissolve would lay the quotation over the text before it; a push keeps them apart.
  quote: ["push", "crossfade"],
  bullets: ["push", "wipe"],
  chart: ["push", "wipe"],
  clip: ["cut"],
  stat: ["zoom", "crossfade"],
  code: ["wipe", "push"],
  terminal: ["wipe", "push"],
  screenshot: ["zoom", "wipe"],
  compare: ["push", "crossfade"],
};

/**
 * The transition into each scene; "none" for the first. A scene's own
 * `transition` wins, then the scenefile's; with both on "auto" the choice
 * comes from the scene being arrived at, with two rules: two scenes of the
 * same type are pushed, like pages, and no kind is chosen twice running.
 */
export function pickTransitions(scenefile: Scenefile): (TransitionKind | "none")[] {
  let previous: TransitionKind | "none" = "none";
  return scenefile.scenes.map((scene, index) => {
    if (index === 0) return "none";
    const asked = scene.transition !== "auto" ? scene.transition : scenefile.transition;
    let kind: TransitionKind;
    if (asked !== "auto") {
      kind = asked;
    } else {
      const sameType = scenefile.scenes[index - 1]?.type === scene.type;
      const options: readonly TransitionKind[] = sameType ? ["push", ...PREFERRED[scene.type]] : PREFERRED[scene.type];
      kind = options.find((option) => option !== previous) ?? "crossfade";
    }
    previous = kind;
    return kind;
  });
}
