import { SHARED_CSS, clipPlacement, escapeHtml, getScene, sceneChrome } from "@scenefile/scenes";
import { captionCues } from "./captions";
import { displayFace, fontFaceCss, videoTexts } from "./fonts";
import type { ResolvedVideo } from "./resolve";
import { getTheme, themeCss } from "./themes";

export interface ManifestScene {
  index: number;
  type: string;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
  /** How this scene arrives; "none" for the first. */
  transition: string;
  /** Frames at the start of this scene shared with the scene before it. */
  overlapFrames: number;
}

/** What the browser runtime needs to place scenes in time. Contains no user text. */
export interface Manifest {
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  scenes: ManifestScene[];
  /** Height left for scenes when captions take a band at the foot of the frame; absent without captions. */
  stageHeight?: number;
}

export interface Composition {
  html: string;
  manifest: Manifest;
  /** Music to mix under the video: a checked local file and its volume. */
  audio?: { file: string; volume: number };
  /** Narration to play over the video: each line's sound file and when it starts. */
  narration?: { file: string; atSeconds: number; seconds: number }[];
  /** The person's own footage, laid over the rendered picture: which part of which file, when, where and how loud. */
  clips?: PlacedClip[];
}

export interface PlacedClip {
  file: string;
  /** Seconds into the file at which to start, and how long it plays. */
  fromSeconds: number;
  seconds: number;
  /** When it starts in the video. */
  atSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True to fill the rectangle and crop; false to fit the whole picture in it. */
  cover: boolean;
  /** 0 when the clip is silent, by choice or because the file has no sound. */
  volume: number;
}

function baseCss(width: number, height: number): string {
  return [
    "*{box-sizing:border-box;margin:0;padding:0}",
    `html,body{width:${width}px;height:${height}px;overflow:hidden;background:var(--sf-bg);color:var(--sf-text);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}`,
    "#sf-stage{position:relative;width:100%;height:100%}",
    // Opaque, so a scene arriving over another covers it.
    ".sf-scene{position:absolute;inset:0;background:var(--sf-bg)}",
    // The lime edge that leads a wipe.
    ".sf-wipe{z-index:2;position:absolute;top:0;bottom:0;width:calc(var(--sf-unit)*0.4);margin-left:calc(var(--sf-unit)*-0.2);background:var(--sf-accent)}",
    ".sf-wipe[hidden]{display:none}",
    ".sf-scene[hidden]{display:none}",
    // Captions take a band at the foot of the frame; scenes are laid out in what is left above it.
    `.sf-captioned .sf-scene,.sf-captioned .sf-wipe{bottom:calc(var(--sf-unit)*${CAPTION_BAND_UNITS})}`,
    `.sf-captions{z-index:3;position:absolute;left:0;right:0;bottom:0;height:calc(var(--sf-unit)*${CAPTION_BAND_UNITS});padding:0 calc(var(--sf-unit)*9);display:flex;align-items:center;background:var(--sf-bg);border-top:1px solid var(--sf-line)}`,
    ".sf-captions p{font:600 calc(var(--sf-unit)*4.4)/1.22 var(--sf-font-sans);letter-spacing:-0.02em;color:var(--sf-text);text-wrap:balance;overflow-wrap:anywhere;max-height:2.44em;overflow:hidden}",
    ".sf-captions p[hidden]{display:none}",
  ].join("");
}

/** Builds the single HTML document Chromium renders. Deterministic: no clock, no network. */
/** Height of the caption band, in units. The CSS below and the layout checks must agree on it. */
export const CAPTION_BAND_UNITS = 17;

export function compile(video: ResolvedVideo): Composition {
  const unit = Math.min(video.width, video.height) / 100;
  // With captions, scenes are laid out and checked in the space above the band.
  const stageHeight = video.captions ? video.height - CAPTION_BAND_UNITS * unit : video.height;
  const manifest: Manifest = {
    fps: video.fps,
    width: video.width,
    height: video.height,
    totalFrames: video.totalFrames,
    ...(video.captions ? { stageHeight } : {}),
    scenes: video.scenes.map(
      ({ index, type, startFrame, durationFrames, enterFrames, exitFrames, transition, overlapFrames }) => ({
        index, type, startFrame, durationFrames, enterFrames, exitFrames, transition, overlapFrames,
      }),
    ),
  };

  const usedTypes = [...new Set(video.scenes.map((scene) => scene.type))];
  const sceneCss = usedTypes.map((type) => getScene(type).css.trim()).join("\n");
  const total = video.scenes.length;
  const sections = video.scenes
    .map((scene) => {
      const inner = getScene(scene.type).compile(scene.props, {
        index: scene.index,
        total,
        path: `scenes[${scene.index}]`,
        frame: { width: video.width, height: stageHeight, unit },
        asset: (src) => video.assets.get(src),
        clip: (src) => video.clips.get(src),
      });
      return `<section class="sf-scene" data-sf-scene="${scene.index}" data-sf-type="${scene.type}" hidden>${inner}</section>`;
    })
    .join("\n");
  const narrated = video.voiceCaptions
    ? video.scenes.flatMap((scene) =>
        scene.speech && scene.props.say !== undefined
          ? captionCues(scene.props.say, scene.speech.startFrame, scene.speech.seconds, video.fps)
          : [],
      )
    : [];
  // What is said in a clip, phrase by phrase, each from when it is heard. A phrase gives way to the next.
  const overheard = video.scenes.flatMap((scene) =>
    (scene.heard ?? []).flatMap((part, at, all) => {
      const until = Math.min(part.end + 0.3, all[at + 1]?.start ?? Number.POSITIVE_INFINITY, scene.durationFrames / video.fps);
      const last = scene.startFrame + Math.round(until * video.fps);
      return captionCues(part.text, scene.startFrame + Math.round(part.start * video.fps), part.end - part.start, video.fps).map((cue) => ({
        ...cue,
        to: Math.min(cue.to, last),
      }));
    }),
  );
  const cues = [...narrated, ...overheard].filter((cue) => cue.to > cue.from).sort((a, b) => a.from - b.from);
  const captions =
    cues.length > 0
      ? `\n<div class="sf-captions">${cues.map((cue) => `<p data-sf-cue="${cue.from},${cue.to}" hidden>${escapeHtml(cue.text)}</p>`).join("")}</div>`
      : "";
  const theme = getTheme(video.theme);
  const texts = videoTexts(video);
  const textIn = (font: "sans" | "mono"): string =>
    texts.filter((entry) => entry.font === font).map((entry) => entry.text).join("");
  // Headings may be set in a third face, or in the monospace one; either then needs the headings' characters.
  const display = displayFace(video).face;
  const monoText = textIn("mono") + (display === theme.fontMono ? textIn("sans") : "");
  const displayCss = display === theme.fontSans || display === theme.fontMono ? "" : `\n${fontFaceCss(display, textIn("sans"))}`;
  const fontCss = `${fontFaceCss(theme.fontSans, textIn("sans"))}\n${fontFaceCss(theme.fontMono, monoText)}${displayCss}`;
  // One copy of each image, by id; the runtime attaches them to the images that name them.
  const assetData = Object.fromEntries([...video.assets.values()].map((asset) => [asset.id, asset.dataUri]));
  const assetsScript =
    video.assets.size > 0
      ? `\n<script id="sf-assets" type="application/json">${JSON.stringify(assetData).replace(/</g, "\\u003c")}</script>`
      : "";
  // "<" is escaped so nothing in the JSON can end the script element.
  const manifestJson = JSON.stringify(manifest).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${fontCss}
${themeCss(video.theme, video.accent, video.width, video.height, display)}${baseCss(video.width, video.height)}
${SHARED_CSS.trim()}
${sceneCss}</style>
</head>
<body>
<div id="sf-stage"${captions ? ' class="sf-captioned"' : ""}>
${sections}
<div class="sf-wipe" hidden></div>
${sceneChrome(total)}${captions}
</div>
<script id="sf-manifest" type="application/json">${manifestJson}</script>${assetsScript}
</body>
</html>`;

  const frame = { width: video.width, height: stageHeight, unit };
  const clips = video.scenes.flatMap((scene): PlacedClip[] => {
    const size = scene.props.type === "clip" ? video.clips.get(scene.props.src) : undefined;
    if (scene.props.type !== "clip" || !scene.clip?.file || !size) return [];
    return [
      {
        file: scene.clip.file,
        fromSeconds: scene.clip.fromSeconds,
        seconds: scene.durationFrames / video.fps,
        atSeconds: scene.startFrame / video.fps,
        ...clipPlacement(scene.props, frame, size),
        volume: scene.clip.audio ? scene.props.volume : 0,
      },
    ];
  });
  return { html, manifest, ...(clips.length > 0 ? { clips } : {}) };
}
