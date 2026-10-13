import { type Diagnostic, type Scenefile, type ThemeName, error, warning } from "@scenefile/schema";
import { type Scene, type TransitionKind, getScene } from "@scenefile/scenes";
import type { AssetMap, ClipInfo, Heard } from "./assets";
import { FORMAT_SIZES } from "./formats";
import { contrastRatio, getTheme } from "./themes";
import { TRANSITION_SECONDS, isOverlapping, pickTransitions } from "./transitions";
import { SPEECH_LEAD_SECONDS, SPEECH_TAIL_SECONDS, type Speech, estimateSpeechSeconds } from "./voice";

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
  /** This scene's narration: when it starts, how long it is, and its sound file once made. */
  speech?: { startFrame: number; seconds: number; file?: string };
  /** For a clip: the file once read, where in it this scene starts, and how long the file is. */
  clip?: { file?: string; fromSeconds: number; totalSeconds?: number; audio: boolean };
  /** For a captioned clip: what is said in the part shown, in seconds from the scene's start. */
  heard?: Heard[];
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
  /** Whether anything is shown as captions, so the frame keeps a band for them. */
  captions: boolean;
  /** Whether narrated lines are among them. */
  voiceCaptions: boolean;
  /** Video clips that were read, by the `src` the scenefile gave. */
  clips: ReadonlyMap<string, ClipInfo>;
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
  speech: ReadonlyMap<number, Speech> = new Map(),
  clips: ReadonlyMap<string, ClipInfo> = new Map(),
  transcripts: ReadonlyMap<number, Heard[]> = new Map(),
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

  // Footage is cut to and cut from: its first and last frames are its own.
  const transitions = pickTransitions(scenefile).map((kind, index) =>
    index > 0 && (scenefile.scenes[index]?.type === "clip" || scenefile.scenes[index - 1]?.type === "clip") ? "cut" : kind,
  );
  const scenes: ResolvedScene[] = [];
  for (const [index, props] of scenefile.scenes.entries()) {
    const definition = getScene(props.type);
    if (props.type === "clip") {
      const info = clips.get(props.src);
      const total = info?.seconds ?? 3;
      const from = props.from ?? 0;
      const to = props.to ?? total;
      const length = total.toFixed(1);
      if (info && from >= total - 0.02) {
        diagnostics.push(
          error("CLIP_RANGE", `scenes[${index}].from`, `This clip is ${length}s long, so it cannot start ${from}s in.`, `Set "from" below ${length}, or remove it to start at the beginning.`),
        );
      } else if (info && to > total + 0.05) {
        diagnostics.push(
          error("CLIP_RANGE", `scenes[${index}].to`, `This clip is ${length}s long, so it cannot run to ${to}s.`, `Set "to" to at most ${(Math.floor(total * 10) / 10).toFixed(1)}, or remove it to play to the end.`),
        );
      }
      const span = Math.max(1 / fps, Math.min(to, total) - Math.min(from, total));
      const asked = props.duration === "auto" ? Number.POSITIVE_INFINITY : toFrames(props.duration, fps);
      const durationFrames = Math.max(1, Math.min(Math.round(span * fps), asked));
      const spoken = props.say === undefined ? undefined : (speech.get(index) ?? { seconds: estimateSpeechSeconds(props.say) });
      const leadFrames = toFrames(SPEECH_LEAD_SECONDS, fps);
      if (spoken && leadFrames + Math.ceil(spoken.seconds * fps) + toFrames(SPEECH_TAIL_SECONDS, fps) > durationFrames) {
        diagnostics.push(
          error(
            "CLIP_TOO_SHORT",
            `scenes[${index}].say`,
            `This line takes about ${spoken.seconds.toFixed(1)}s to say, but the clip is on screen for ${(durationFrames / fps).toFixed(1)}s.`,
            "Shorten the line, or show more of the clip.",
          ),
        );
      }
      const before = scenes[index - 1];
      if (before) before.exitFrames = 0;
      scenes.push({
        index, type: props.type, props, startFrame: cursor, durationFrames, enterFrames: 0, exitFrames: 0,
        transition: transitions[index] ?? "none", overlapFrames: 0,
        ...(spoken ? { speech: { startFrame: cursor + leadFrames, ...spoken } } : {}),
        clip: { ...(info ? { file: info.file, totalSeconds: info.seconds } : {}), fromSeconds: from, audio: info?.audio ?? false },
        // Only what falls inside the part shown, and no later than the scene's end.
        ...(props.captions !== false && transcripts.has(index)
          ? {
              heard: (transcripts.get(index) ?? [])
                .filter((part) => part.start < durationFrames / fps && part.end > 0)
                .map((part) => ({ ...part, start: Math.max(0, part.start), end: Math.min(part.end, durationFrames / fps) })),
            }
          : {}),
      });
      cursor += durationFrames;
      continue;
    }
    const enterFrames = toFrames(definition.enterSeconds, fps);
    const exitFrames = toFrames(definition.exitSeconds, fps);
    const autoSeconds =
      definition.enterSeconds +
      Math.max(definition.minHoldSeconds, definition.holdSeconds(props)) +
      definition.exitSeconds;

    // A scene must last long enough for its content to finish appearing; cut
    // shorter, it would end on a half-typed command or a number still counting.
    const reveal = definition.revealSeconds?.(props) ?? 0;
    const spoken = props.say === undefined ? undefined : (speech.get(index) ?? { seconds: estimateSpeechSeconds(props.say) });
    const leadFrames = toFrames(SPEECH_LEAD_SECONDS, fps);
    // A narrated scene stays until its line has been said, with a breath after it.
    const speechFrames = spoken
      ? leadFrames + Math.ceil(spoken.seconds * fps) + toFrames(SPEECH_TAIL_SECONDS, fps) + exitFrames
      : 0;
    const revealFrames = reveal > 0 ? enterFrames + Math.ceil((reveal + MIN_REST_SECONDS) * fps) + exitFrames : 0;
    const minFrames = Math.max(enterFrames + exitFrames + 1, revealFrames, speechFrames);
    const lengthened =
      props.duration !== "auto" && (reveal > 0 || spoken !== undefined) && toFrames(props.duration, fps) < minFrames;

    if (props.duration !== "auto") {
      const path = `scenes[${index}].duration`;
      const needed = autoSeconds.toFixed(1);
      if (lengthened) {
        const minimum = (minFrames / fps).toFixed(1);
        diagnostics.push(
          warning(
            "PACING_FAST",
            path,
            `${props.duration}s would end this scene before its ${speechFrames > revealFrames ? "narration" : "animation"} finishes, so it was lengthened to ${minimum}s.`,
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
    scenes.push({
      index, type: props.type, props, startFrame, durationFrames, enterFrames, exitFrames, transition, overlapFrames,
      ...(spoken ? { speech: { startFrame: startFrame + leadFrames, ...spoken } } : {}),
    });
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
      captions:
        (scenefile.voice?.captions === true && scenes.some((scene) => scene.speech)) || scenes.some((scene) => (scene.heard?.length ?? 0) > 0),
      voiceCaptions: scenefile.voice?.captions === true && scenes.some((scene) => scene.speech),
      clips,
    },
    diagnostics,
  };
}
