import { type Diagnostic, type Scenefile, type ThemeName, error, warning } from "@scenefile/schema";
import { type Scene, type TransitionKind, getScene } from "@scenefile/scenes";
import type { AssetMap } from "./assets";
import { FORMAT_SIZES } from "./formats";
import { contrastRatio, getTheme } from "./themes";
import { TRANSITION_SECONDS, isOverlapping, pickTransitions } from "./transitions";

export interface ResolvedScene {
  index: number;
  type: Scene["type"];
  props: Scene;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
  /** How this scene arrives from the one before it; "none" for the first scene. */
  transition: TransitionKind | "none";
  /** Frames at the start of this scene during which the scene before it is still drawn. */
  overlapFrames: number;
}

export interface ResolvedVideo {
  width: number;
  height: number;
  fps: number;
  theme: ThemeName;
  accent: string | undefined;
  totalFrames: number;
  scenes: ResolvedScene[];
  /** Loaded images, by the `src` the scenefile gave. */
  assets: AssetMap;
}

const MIN_TOTAL_SECONDS = 3;
const MAX_TOTAL_SECONDS = 600;
/** An explicit duration below this share of the automatic one is too fast to read. */
const FAST_RATIO = 0.75;
const SLOW_RATIO = 3;
/** WCAG's minimum for large text, which is what the accent is used for. */
const MIN_ACCENT_CONTRAST = 3;
/** Seconds the finished content stays up, at the least, before the scene exits. */
const MIN_REST_SECONDS = 0.3;

function toFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** Turns "auto" values into numbers and places every scene on the frame timeline. */
export function resolve(
  scenefile: Scenefile,
  assets: AssetMap = new Map(),
): { video: ResolvedVideo; diagnostics: Diagnostic[] } {
  const { fps } = scenefile;
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;

  if (scenefile.accent !== undefined) {
    const ratio = contrastRatio(scenefile.accent, getTheme(scenefile.theme).background);
    if (ratio < MIN_ACCENT_CONTRAST) {
      diagnostics.push(
        error(
          "CONTRAST_LOW",
          "accent",
          `Accent ${scenefile.accent} has a contrast of ${ratio.toFixed(1)}:1 against the "${scenefile.theme}" background; text in it cannot be read.`,
          `Choose a color with at least ${MIN_ACCENT_CONTRAST}:1 contrast, or remove "accent" to use the theme's own.`,
        ),
      );
    }
  }

  const transitions = pickTransitions(scenefile);
  const scenes: ResolvedScene[] = [];
  for (const [index, props] of scenefile.scenes.entries()) {
    const definition = getScene(props.type);
    const enterFrames = toFrames(definition.enterSeconds, fps);
    const exitFrames = toFrames(definition.exitSeconds, fps);
    const autoSeconds =
      definition.enterSeconds +
      Math.max(definition.minHoldSeconds, definition.holdSeconds(props)) +
      definition.exitSeconds;

    // A scene must last long enough for its content to finish appearing; cut
    // shorter, it would end on a half-typed command or a number still counting.
    const reveal = definition.revealSeconds?.(props) ?? 0;
    const minFrames = Math.max(
      enterFrames + exitFrames + 1,
      reveal > 0 ? enterFrames + Math.ceil((reveal + MIN_REST_SECONDS) * fps) + exitFrames : 0,
    );
    const lengthened = props.duration !== "auto" && reveal > 0 && toFrames(props.duration, fps) < minFrames;

    if (props.duration !== "auto") {
      const path = `scenes[${index}].duration`;
      const needed = autoSeconds.toFixed(1);
      if (lengthened) {
        const minimum = (minFrames / fps).toFixed(1);
        diagnostics.push(
          warning(
            "PACING_FAST",
            path,
            `${props.duration}s would end this scene before its animation finishes, so it was lengthened to ${minimum}s.`,
            `Set "duration" to "auto" or to at least ${minimum}.`,
          ),
        );
      } else if (props.duration < autoSeconds * FAST_RATIO) {
        diagnostics.push(
          warning(
            "PACING_FAST",
            path,
            `${props.duration}s is too short to read this scene; it needs about ${needed}s.`,
            `Set "duration" to "auto" or to at least ${needed}.`,
          ),
        );
      } else if (props.duration > autoSeconds * SLOW_RATIO) {
        diagnostics.push(
          warning(
            "PACING_SLOW",
            path,
            `${props.duration}s is much longer than the ${needed}s this scene needs; it will feel stalled.`,
            `Set "duration" to "auto" or add content to the scene.`,
          ),
        );
      }
    }

    const requested = toFrames(props.duration === "auto" ? autoSeconds : props.duration, fps);
    const durationFrames = Math.max(requested, minFrames);

    const transition = transitions[index] ?? "none";
    const before = scenes[index - 1];
    let overlapFrames = 0;
    if (before && transition !== "fade") {
      // Anything but a fade leaves the earlier scene fully drawn to its last frame.
      before.exitFrames = 0;
      if (isOverlapping(transition)) {
        // The shared frames may not eat into the time the earlier scene needs to
        // finish appearing, nor be as long as either scene.
        const beforeReveal = getScene(before.type).revealSeconds?.(before.props) ?? 0;
        const beforeFree = before.durationFrames - before.enterFrames - Math.ceil(beforeReveal * fps) - 1;
        overlapFrames = Math.max(0, Math.min(toFrames(TRANSITION_SECONDS, fps), beforeFree, durationFrames - 1));
      }
    }
    const startFrame = cursor - overlapFrames;
    scenes.push({ index, type: props.type, props, startFrame, durationFrames, enterFrames, exitFrames, transition, overlapFrames });
    cursor = startFrame + durationFrames;
  }

  const totalSeconds = cursor / fps;
  const shared = scenes.reduce((sum, scene) => sum + scene.overlapFrames, 0);
  if (totalSeconds < MIN_TOTAL_SECONDS || totalSeconds > MAX_TOTAL_SECONDS) {
    diagnostics.push(
      error(
        "TOTAL_DURATION",
        "scenes",
        `The video is ${totalSeconds.toFixed(1)}s long; it must be between ${MIN_TOTAL_SECONDS}s and ${MAX_TOTAL_SECONDS}s.`,
        totalSeconds < MIN_TOTAL_SECONDS
          ? `Add scenes or lengthen them.${shared > 0 ? ` Scenes overlap during transitions, by ${(shared / fps).toFixed(1)}s in total here, so the video is shorter than its durations added up.` : ""}`
          : "Remove scenes or shorten them.",
      ),
    );
  }

  const size = FORMAT_SIZES[scenefile.format];
  return {
    video: {
      width: size.width,
      height: size.height,
      fps,
      theme: scenefile.theme,
      accent: scenefile.accent,
      totalFrames: cursor,
      scenes,
      assets,
    },
    diagnostics,
  };
}
