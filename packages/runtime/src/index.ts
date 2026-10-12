import { type SceneHandle, mounts } from "@scenefile/scenes/browser";
import {
  type ConflictReport,
  type LabelReport,
  type SlotReport,
  fitSlots,
  inspectLabels,
  isCrowded,
  relieveCrowding,
} from "./fit";

interface ManifestScene {
  index: number;
  type: string;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
}

interface Manifest {
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  scenes: ManifestScene[];
}

/** How an image ended up on screen. Mirrors `ImageReport` in @scenefile/engine. */
interface ImageReport {
  path: string;
  naturalWidth: number;
  naturalHeight: number;
  shownWidth: number;
  shownHeight: number;
}

interface Mounted {
  scene: ManifestScene;
  el: HTMLElement;
  handle: SceneHandle;
}

interface Api {
  seek(frame: number): void;
  totalFrames: number;
  report: {
    slots: SlotReport[];
    crowded: number[];
    images: ImageReport[];
    broken: string[];
    labels: LabelReport[];
    conflicts: ConflictReport[];
  };
}

function init(broken: string[]): Api {
  const manifestEl = document.getElementById("sf-manifest");
  if (!manifestEl?.textContent) throw new Error("scenefile: the composition has no manifest");
  const manifest = JSON.parse(manifestEl.textContent) as Manifest;

  const mounted = manifest.scenes.map((scene): Mounted => {
    const el = document.querySelector<HTMLElement>(`[data-sf-scene="${scene.index}"]`);
    const mount = mounts[scene.type];
    if (!el) throw new Error(`scenefile: scene ${scene.index} is missing from the document`);
    if (!mount) throw new Error(`scenefile: no browser mount for scene type "${scene.type}"`);
    const handle = mount(el, {
      fps: manifest.fps,
      durationFrames: scene.durationFrames,
      enterFrames: scene.enterFrames,
      exitFrames: scene.exitFrames,
    });
    return { scene, el, handle };
  });

  // Fit text once, before any frame is drawn. Each scene is measured as it
  // looks fully revealed (its last frame before the exit), so text that is
  // typed or staggered in over time is measured at full length.
  const unitPx = Math.min(manifest.width, manifest.height) / 100;
  const slots: SlotReport[] = [];
  const crowded: number[] = [];
  const images: ImageReport[] = [];
  const labels: LabelReport[] = [];
  const conflicts: ConflictReport[] = [];
  for (const { scene, el, handle } of mounted) {
    el.hidden = false;
    handle.seek(Math.max(0, scene.durationFrames - scene.exitFrames - 1));
    const fitted = fitSlots(el, unitPx, manifest);
    relieveCrowding(el, unitPx, manifest, fitted);
    slots.push(...fitted);
    if (isCrowded(el)) crowded.push(scene.index);
    const inspected = inspectLabels(el, manifest);
    labels.push(...inspected.labels);
    conflicts.push(...inspected.conflicts);
    for (const image of el.querySelectorAll<HTMLImageElement>("img[data-sf-image]")) {
      images.push({
        path: image.dataset.sfPath ?? "",
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        // The laid-out size, not the on-screen one: a scene may be mid-zoom.
        shownWidth: image.offsetWidth,
        shownHeight: image.offsetHeight,
      });
    }
    el.hidden = true;
  }

  const root = document.documentElement;

  return {
    totalFrames: manifest.totalFrames,
    report: { slots, crowded, images, broken, labels, conflicts },
    seek(frame) {
      // Chromium carries paint and compositing state from one frame to the next,
      // so identical DOM can differ by one level on anti-aliased edges depending
      // on which frames came before. Taking the whole document out of layout and
      // putting it back discards that state, so pixels depend on the frame alone.
      // Detaching less than the document is not enough: it was tried with only
      // the stage and frames still differed. Both forced layouts are required;
      // without them the browser coalesces the two style changes.
      root.style.display = "none";
      void root.offsetHeight;
      for (const { scene, el, handle } of mounted) {
        const local = frame - scene.startFrame;
        const active = local >= 0 && local < scene.durationFrames;
        el.hidden = !active;
        if (active) handle.seek(local);
      }
      root.style.display = "";
      void root.offsetHeight;
    },
  };
}

async function start(): Promise<void> {
  // Faces load lazily; text measured before they arrive would be measured in a fallback font.
  await Promise.all(Array.from(document.fonts, (face) => face.load()));
  // The page holds one copy of each image's data; attach it to every image that names it.
  const assetsEl = document.getElementById("sf-assets");
  const assets = (assetsEl?.textContent ? JSON.parse(assetsEl.textContent) : {}) as Record<string, string>;
  const pictures = Array.from(document.querySelectorAll<HTMLImageElement>("img[data-sf-asset]"));
  for (const image of pictures) image.src = assets[image.dataset.sfAsset ?? ""] ?? "";
  // Images decode off the main thread; a frame captured before they finish would
  // show a blank box. One that cannot be decoded is reported, not fatal: it is
  // a problem with the scenefile's image, to be told to whoever wrote it.
  const broken: string[] = [];
  await Promise.all(
    pictures.map((image) =>
      image.decode().catch(() => {
        const path = image.dataset.sfPath ?? "";
        if (!broken.includes(path)) broken.push(path);
      }),
    ),
  );
  (window as unknown as { __scenefile: Api }).__scenefile = init(broken);
}

(window as unknown as { __scenefileReady: Promise<void> }).__scenefileReady = start();
