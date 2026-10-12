import { fileURLToPath } from "node:url";
import { applyLayout, checkWithAssets, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { captureFrame, inspectComposition, openComposition } from "../src/index";

const baseDir = fileURLToPath(new URL("../../scenes/test", import.meta.url));
const filler = { type: "title", heading: "one two three four five six seven eight nine" };

async function compose(input: Record<string, unknown>) {
  const result = await checkWithAssets({ version: 1, ...input }, { baseDir });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return { result, composition: result.composition };
}

describe("images in a real browser", () => {
  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])(
    "shows tall, wide and ordinary images whole, inside the frame, in %s",
    async (format) => {
      const { composition } = await compose({
        format,
        scenes: ["shot.png", "tall.png", "wide.png"].map((name) => ({
          type: "screenshot",
          src: `assets/${name}`,
          url: "scenefile.dev",
          caption: "A caption under the image.",
        })),
      });
      const { width, height } = composition.manifest;
      const session = await openComposition(composition);
      try {
        for (const scene of composition.manifest.scenes) {
          await captureFrame(session.page, scene.startFrame + scene.enterFrames + 5);
          const box = await session.page.evaluate(() => {
            const visible = document.querySelector(".sf-scene:not([hidden])");
            const image = visible?.querySelector("img");
            const view = visible?.querySelector(".sf-shot__view");
            const caption = visible?.querySelector(".sf-shot__caption");
            const chrome = visible?.querySelector(".sf-chrome");
            if (!image || !view || !caption || !chrome) return null;
            const rect = view.getBoundingClientRect();
            return {
              left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              complete: image.complete && image.naturalWidth > 0,
              ratio: image.naturalWidth / image.naturalHeight,
              captionTop: caption.getBoundingClientRect().top,
              chromeBottom: chrome.getBoundingClientRect().bottom,
            };
          });
          if (!box) throw new Error("scene is missing its image, caption or counter");
          expect(box.complete).toBe(true);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(box.top).toBeGreaterThan(box.chromeBottom);
          expect(box.bottom).toBeLessThanOrEqual(box.captionTop + 1);
          expect(box.bottom).toBeLessThanOrEqual(height);
          // Shown whole: the box has the image's own shape (within a pixel of rounding).
          const shownRatio = (box.right - box.left) / (box.bottom - box.top);
          expect(Math.abs(shownRatio - box.ratio) / box.ratio).toBeLessThan(0.03);
        }
      } finally {
        await session.close();
      }
    },
  );

  it("reports the size each image is shown at, and warns when a small one is stretched", async () => {
    const { result, composition } = await compose({
      scenes: [{ type: "screenshot", src: "assets/shot.png" }, { type: "screenshot", src: "assets/small.png" }, filler],
    });
    const report = await inspectComposition(composition);
    expect(report.images?.map((image) => [image.path, image.naturalWidth, image.naturalHeight])).toEqual([
      ["scenes[0].src", 1280, 720],
      ["scenes[1].src", 320, 180],
    ]);
    const diagnostics = verifyLayout(report);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "ASSET_LOW_RES", severity: "warning", path: "scenes[1].src" }),
    ]);
    const laidOut = applyLayout(result, report);
    expect(laidOut.ok).toBe(true);
    expect(laidOut.storyboard).toMatch(/src\s+1280x720 image, shown at \d+x\d+/);
  });

  it("fails the check, without rendering, when an image cannot be loaded", async () => {
    const result = await checkWithAssets(
      { version: 1, scenes: [{ type: "screenshot", src: "assets/nope.png" }, { type: "screenshot", src: "../../README.md" }, filler] },
      { baseDir },
    );
    expect(result.ok).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["ASSET_NOT_FOUND", "scenes[0].src"],
      ["ASSET_NOT_FOUND", "scenes[1].src"],
    ]);
  });
});
