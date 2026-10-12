import { SHARED_CSS, getScene } from "@scenefile/scenes";
import type { ResolvedVideo } from "./resolve";
import { themeCss } from "./themes";

export interface ManifestScene {
  index: number;
  type: string;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
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
}

function baseCss(width: number, height: number): string {
  return [
    "*{box-sizing:border-box;margin:0;padding:0}",
    `html,body{width:${width}px;height:${height}px;overflow:hidden;background:var(--sf-bg);color:var(--sf-text);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}`,
    "#sf-stage{position:relative;width:100%;height:100%}",
    ".sf-scene{position:absolute;inset:0}",
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
    scenes: video.scenes.map(({ index, type, startFrame, durationFrames, enterFrames, exitFrames }) => ({
      index, type, startFrame, durationFrames, enterFrames, exitFrames,
    })),
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
      });
      return `<section class="sf-scene" data-sf-scene="${scene.index}" data-sf-type="${scene.type}" hidden>${inner}</section>`;
    })
    .join("\n");
  // "<" is escaped so nothing in the JSON can end the script element.
  const manifestJson = JSON.stringify(manifest).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${themeCss(video.theme, video.accent, video.width, video.height)}${baseCss(video.width, video.height)}
${SHARED_CSS.trim()}
${sceneCss}</style>
</head>
<body>
<div id="sf-stage">
${sections}
</div>
<script id="sf-manifest" type="application/json">${manifestJson}</script>
</body>
</html>`;

  return { html, manifest };
}
