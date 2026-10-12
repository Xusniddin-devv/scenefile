import { type SceneHandle, mounts } from "@scenefile/scenes/browser";

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
  totalFrames: number;
  scenes: ManifestScene[];
}

interface Mounted {
  scene: ManifestScene;
  el: HTMLElement;
  handle: SceneHandle;
}

function init(): { seek(frame: number): void; totalFrames: number } {
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

  const root = document.documentElement;

  return {
    totalFrames: manifest.totalFrames,
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

(window as unknown as { __scenefile: ReturnType<typeof init> }).__scenefile = init();
