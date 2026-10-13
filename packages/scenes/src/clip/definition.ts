import { containSize } from "../image";
import { escapeHtml } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type ClipProps, clipSchema } from "./schema";

/** Layout, in units: the clip gets what the frame leaves after these. The same margins as a screenshot. */
const TOP = 17;
const BOTTOM = 8;
const SIDE = 9;
const CAPTION = 9;

export interface ClipPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the clip fills the box and is cropped, rather than fitted inside it. */
  cover: boolean;
}

/**
 * Where a clip's picture goes in the frame, in whole pixels. The page leaves
 * this rectangle empty and the renderer lays the clip over it, so the two must
 * be worked out by the same rule: this one.
 */
export function clipPlacement(
  props: Pick<ClipProps, "fit" | "caption" | "backdrop">,
  frame: { width: number; height: number; unit: number },
  clip: { width: number; height: number },
): ClipPlacement {
  const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2);
  /** A position on the even grid; unlike a size, it may be zero. */
  const at = (value: number): number => Math.max(0, Math.floor(value / 2) * 2);
  if (props.fit === "cover") return { x: 0, y: 0, width: even(frame.width), height: even(frame.height), cover: true };
  if (props.backdrop === "blur") {
    // With its own picture blurred behind it, the clip takes the whole height and width there is.
    const whole = containSize(clip, { width: frame.width, height: frame.height });
    const [width, height] = [even(whole.width), even(whole.height)];
    return { x: at((frame.width - width) / 2), y: at((frame.height - height) / 2), width, height, cover: false };
  }
  const box = {
    width: frame.width - 2 * SIDE * frame.unit,
    height: frame.height - (TOP + BOTTOM + (props.caption ? CAPTION : 0)) * frame.unit,
  };
  const size = containSize(clip, box);
  const width = even(size.width);
  // In the middle of the width it could have used, so a tall clip in a wide frame does not hug one edge.
  // Even positions as well as even sizes: color in video is stored every other pixel, and footage placed
  // on an odd one lands a pixel off, leaving a line of the page beside it.
  return { x: at((frame.width - width) / 2), y: at(TOP * frame.unit), width, height: even(size.height), cover: false };
}

function span(props: ClipProps): string {
  if (props.from === undefined && props.to === undefined) return "";
  return `, ${(props.from ?? 0).toFixed(2)}s to ${props.to === undefined ? "its end" : `${props.to.toFixed(2)}s`}`;
}

export const clipDefinition: SceneDefinition<ClipProps> = {
  type: "clip",
  fields: Object.keys(clipSchema.shape),
  // A clip is shown from its first frame to its last: nothing fades, and its length is the footage's.
  enterSeconds: 0,
  exitSeconds: 0,
  minHoldSeconds: 0,
  // Its real length comes from the file; this stands in only where the file is not known.
  holdSeconds: () => 3,
  summary: (props) => `video ${props.src}${span(props)}`,
  texts(props) {
    const texts: SceneText[] = [];
    if (props.caption && props.fit !== "cover" && props.backdrop !== "blur") texts.push({ path: "caption", text: props.caption, font: "sans" });
    return texts;
  },
  clips: (props) => [{ path: "src", src: props.src }],
  compile(props, ctx) {
    // 16:9 stands in for a clip that is not available, so the layout still holds.
    const placed = clipPlacement(props, ctx.frame, ctx.clip?.(props.src) ?? { width: 16, height: 9 });
    const caption =
      props.caption && !placed.cover && props.backdrop !== "blur"
        ? `<p class="sf-clip__caption" style="left:${placed.x}px;top:${placed.y + placed.height + Math.round(2 * ctx.frame.unit)}px" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.caption">${escapeHtml(props.caption)}</p>`
        : "";
    return `<div class="sf-clip"><div class="sf-clip__box" style="left:${placed.x}px;top:${placed.y}px;width:${placed.width}px;height:${placed.height}px"></div>${caption}</div>`;
  },
  doc: {
    purpose: "One of the person's own video files, or a part of it. Put several in a row to join them.",
    fields: {
      "src": "The video: an MP4, MOV or WebM file in the scenefile's folder. Required.",
      "from": "Seconds into the file to start at. Leave out to start at the beginning.",
      "to": "Seconds into the file to stop at. Leave out to play to the end. The scene lasts exactly as long as what is shown, and is cut to and from.",
      "fit": '"contain" (default) shows the whole picture inside the frame; "cover" fills the frame and crops.',
      "speed": "How fast it plays, from 0.25 to 4. Default 1.",
      "mono": "Set true for black and white.",
      "zoom": '"in" or "out" for a slow zoom while it plays.',
      "backdrop": '"blur" fills the frame behind a clip that does not fill it (a tall clip in a wide video) with a blurred copy of itself.',
      "volume": "The clip's own sound, from 0 (silent) to 1 (default). Use 0 when the scene is narrated.",
      "captions": 'Set true to caption what is said in the clip: the words are heard from its sound, you do not write them. Give the language instead ("en", "ru") if it is heard wrongly. Not used on a clip with `say`.',
      "caption": 'A line under the clip, up to 80 characters. Not shown with "cover".',
    },
    example: {
      "type": "clip",
      "src": "demo.mp4",
      "from": 3,
      "to": 9,
      "caption": "Signing in",
    },
  },
  css: `
.sf-clip__box{position:absolute;background:var(--sf-surface)}
.sf-clip__caption{position:absolute;right:calc(var(--sf-unit)*9);font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
`,
};
