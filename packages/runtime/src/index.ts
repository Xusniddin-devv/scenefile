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

  const stage = document.getElementById("sf-stage");
  if (!stage) throw new Error("scenefile: the composition has no stage");

  return {
    totalFrames: manifest.totalFrames,
    seek(frame) {
      // Chromium keeps compositing state from earlier frames (an element that was
      // once translucent or transformed is rasterized along a different path), so
      // identical DOM can differ by one level on text edges. Detaching the stage
      // and forcing layout discards that state, making pixels depend on the frame
      // alone. Both forced layouts are required; without them the browser
      // coalesces the two style changes and nothing is rebuilt.
      stage.style.display = "none";
      void stage.offsetHeight;
      for (const { scene, el, handle } of mounted) {
        const local = frame - scene.startFrame;
        const active = local >= 0 && local < scene.durationFrames;
        el.hidden = !active;
        if (active) handle.seek(local);
      }
      stage.style.display = "";
      void stage.offsetHeight;
    },
  };
}

(window as unknown as { __scenefile: ReturnType<typeof init> }).__scenefile = init();
