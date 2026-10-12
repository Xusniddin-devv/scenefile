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

  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])(
    "keeps both sides of a comparison inside the frame and apart, in %s",
    async (format) => {
      const { composition } = await compose({
        format,
        scenes: [
          { type: "compare", before: { src: "assets/tall.png" }, after: { src: "assets/wide.png" } },
          { type: "compare", before: { text: "Forty lines of animation code the model cannot check." }, after: { src: "assets/shot.png" } },
        ],
      });
      expect(verifyLayout(await inspectComposition(composition)).filter((d) => d.severity === "error")).toEqual([]);
      const { width, height } = composition.manifest;
      const session = await openComposition(composition);
      try {
        for (const scene of composition.manifest.scenes) {
          await captureFrame(session.page, scene.startFrame + scene.durationFrames - scene.exitFrames - 1);
          const sides = await session.page.evaluate(() => {
            const visible = document.querySelector(".sf-scene:not([hidden])");
            const chromeBottom = visible?.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
            return Array.from(visible?.querySelectorAll(".sf-compare__body") ?? [], (body) => {
              const rect = (body.firstElementChild ?? body).getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, chromeBottom };
            });
          });
          expect(sides).toHaveLength(2);
          for (const side of sides) {
            expect(side.left).toBeGreaterThanOrEqual(0);
            expect(side.right).toBeLessThanOrEqual(width);
            expect(side.top).toBeGreaterThan(side.chromeBottom);
            expect(side.bottom).toBeLessThanOrEqual(height);
          }
          const [a, b] = sides;
          if (!a || !b) throw new Error("missing sides");
          const apart = a.right <= b.left + 1 || a.bottom <= b.top + 1;
          expect(apart).toBe(true);
        }
      } finally {
        await session.close();
      }
    },
  );

  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])(
    "keeps every callout label whole inside the frame, wherever the callout points, in %s",
    async (format) => {
      const long = "A label at the forty character limit ok";
      const corners = [
        [{ x: 0.02, y: 0.02, label: long }, { x: 0.98, y: 0.02, label: long }, { x: 0.5, y: 0.5, label: long }],
        [{ x: 0.02, y: 0.98, label: long }, { x: 0.98, y: 0.98, label: "Short" }, { x: 0.75, y: 0.5, label: "Marked lines stay bright" }],
      ];
      const { composition } = await compose({
        format,
        scenes: corners.flatMap((callouts) =>
          ["shot.png", "tall.png"].map((name) => ({ type: "screenshot", src: `assets/${name}`, callouts })),
        ),
      });
      const { width, height } = composition.manifest;
      const session = await openComposition(composition);
      try {
        for (const scene of composition.manifest.scenes) {
          await captureFrame(session.page, scene.startFrame + scene.durationFrames - scene.exitFrames - 1);
          // A narrow image cannot hold a long label, so labels may leave the image; they may not leave the frame.
          const overhangs = await session.page.evaluate(
            ({ frameWidth, frameHeight }) => {
              const visible = document.querySelector(".sf-scene:not([hidden])");
              const top = visible?.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
              return Array.from(visible?.querySelectorAll(".sf-shot__pin b") ?? [], (label) => {
                const rect = label.getBoundingClientRect();
                return Math.max(-rect.left, rect.right - frameWidth, top - rect.top, rect.bottom - frameHeight);
              });
            },
            { frameWidth: width, frameHeight: height },
          );
          expect(overhangs).toHaveLength(3);
          for (const overhang of overhangs) expect(overhang, `scene ${scene.index}`).toBeLessThanOrEqual(0);
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
