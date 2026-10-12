import { type Diagnostic, type Scenefile, type ThemeName, error, warning } from "@scenefile/schema";
import { type Scene, getScene } from "@scenefile/scenes";
import { FORMAT_SIZES } from "./formats";

export interface ResolvedScene {
  index: number;
  type: Scene["type"];
  props: Scene;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
}

export interface ResolvedVideo {
  width: number;
  height: number;
  fps: number;
  theme: ThemeName;
  accent: string | undefined;
  totalFrames: number;
  scenes: ResolvedScene[];
}

const MIN_TOTAL_SECONDS = 3;
const MAX_TOTAL_SECONDS = 600;
/** An explicit duration below this share of the automatic one is too fast to read. */
const FAST_RATIO = 0.75;
const SLOW_RATIO = 3;

function toFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** Turns "auto" values into numbers and places every scene on the frame timeline. */
export function resolve(scenefile: Scenefile): { video: ResolvedVideo; diagnostics: Diagnostic[] } {
  const { fps } = scenefile;
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;

  const scenes = scenefile.scenes.map((props, index): ResolvedScene => {
    const definition = getScene(props.type);
    const enterFrames = toFrames(definition.enterSeconds, fps);
    const exitFrames = toFrames(definition.exitSeconds, fps);
    const autoSeconds =
      definition.enterSeconds +
      Math.max(definition.minHoldSeconds, definition.holdSeconds(props)) +
      definition.exitSeconds;

    if (props.duration !== "auto") {
      const path = `scenes[${index}].duration`;
      const needed = autoSeconds.toFixed(1);
      if (props.duration < autoSeconds * FAST_RATIO) {
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
    const durationFrames = Math.max(requested, enterFrames + exitFrames + 1);
    const scene = { index, type: props.type, props, startFrame: cursor, durationFrames, enterFrames, exitFrames };
    cursor += durationFrames;
    return scene;
  });

  const totalSeconds = cursor / fps;
  if (totalSeconds < MIN_TOTAL_SECONDS || totalSeconds > MAX_TOTAL_SECONDS) {
    diagnostics.push(
      error(
        "TOTAL_DURATION",
        "scenes",
        `The video is ${totalSeconds.toFixed(1)}s long; it must be between ${MIN_TOTAL_SECONDS}s and ${MAX_TOTAL_SECONDS}s.`,
        totalSeconds < MIN_TOTAL_SECONDS ? "Add scenes or lengthen them." : "Remove scenes or shorten them.",
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
    },
    diagnostics,
  };
}
