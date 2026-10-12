import { SHARED_CSS, getScene, sceneChrome } from "@scenefile/scenes";
import { fontFaceCss, videoTexts } from "./fonts";
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
}

export interface Composition {
  html: string;
  manifest: Manifest;
  /** Music to mix under the video: a checked local file and its volume. */
  audio?: { file: string; volume: number };
  /** Narration to play over the video: each line's sound file and when it starts. */
  narration?: { file: string; atSeconds: number; seconds: number }[];
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
  ].join("");
}

/** Builds the single HTML document Chromium renders. Deterministic: no clock, no network. */
export function compile(video: ResolvedVideo): Composition {
  const manifest: Manifest = {
    fps: video.fps,
    width: video.width,
    height: video.height,
    totalFrames: video.totalFrames,
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
        frame: { width: video.width, height: video.height, unit: Math.min(video.width, video.height) / 100 },
        asset: (src) => video.assets.get(src),
      });
      return `<section class="sf-scene" data-sf-scene="${scene.index}" data-sf-type="${scene.type}" hidden>${inner}</section>`;
    })
    .join("\n");
  const theme = getTheme(video.theme);
  const texts = videoTexts(video);
  const textIn = (font: "sans" | "mono"): string =>
    texts.filter((entry) => entry.font === font).map((entry) => entry.text).join("");
  const fontCss = `${fontFaceCss(theme.fontSans, textIn("sans"))}\n${fontFaceCss(theme.fontMono, textIn("mono"))}`;
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
${themeCss(video.theme, video.accent, video.width, video.height)}${baseCss(video.width, video.height)}
${SHARED_CSS.trim()}
${sceneCss}</style>
</head>
<body>
<div id="sf-stage">
${sections}
<div class="sf-wipe" hidden></div>
${sceneChrome(total)}
</div>
<script id="sf-manifest" type="application/json">${manifestJson}</script>${assetsScript}
</body>
</html>`;

  return { html, manifest };
}
