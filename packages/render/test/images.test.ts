import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyLayout, checkWithAssets, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { captureFrame, inspectComposition, openComposition } from "../src/index";

const baseDir = fileURLToPath(new URL("../../scenes/test", import.meta.url));
const filler = { type: "title", heading: "one two three four five six seven eight nine" };

async function compose(input: Record<string, unknown>) {
  // These tests measure positions on a scene's last frames; a cut keeps scenes still there.
  const result = await checkWithAssets({ version: 1, transition: "cut", ...input }, { baseDir });
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
            const chrome = document.querySelector(".sf-chrome");
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
            const chromeBottom = document.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
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
              const top = document.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
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

  it("fails the check, without rendering, when an image is missing or outside the scenefile's folder", async () => {
    // The second path names a file that exists (the repository's README), so only confinement can refuse it.
    const result = await checkWithAssets(
      { version: 1, scenes: [{ type: "screenshot", src: "assets/nope.png" }, { type: "screenshot", src: "../../../README.md" }, filler] },
      { baseDir },
    );
    expect(result.ok).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["ASSET_NOT_FOUND", "scenes[0].src"],
      ["ASSET_NOT_FOUND", "scenes[1].src"],
    ]);
    expect(result.diagnostics[0]?.message).toContain("no file");
    expect(result.diagnostics[1]?.message).toContain("outside");
  });

  it("embeds an image once however many scenes show it", async () => {
    const shot = { type: "screenshot", src: "assets/shot.png" };
    const { composition } = await compose({ scenes: [shot, shot, { type: "compare", before: { src: "assets/shot.png" }, after: { text: "Same image." } }] });
    expect(composition.html.match(/data:image\/png;base64,/g)).toHaveLength(1);
    expect(composition.html).not.toMatch(/https?:\/\//);
    const session = await openComposition(composition);
    try {
      for (const scene of composition.manifest.scenes) {
        await captureFrame(session.page, scene.startFrame + scene.enterFrames + 5);
        const drawn = await session.page.evaluate(() => {
          const image = document.querySelector<HTMLImageElement>(".sf-scene:not([hidden]) img");
          return Boolean(image?.complete && image.naturalWidth === 1280);
        });
        expect(drawn, `scene ${scene.index}`).toBe(true);
      }
    } finally {
      await session.close();
    }
  });

  it("reports an image that passes the header check but cannot be decoded, instead of crashing", async () => {
    const folder = mkdtempSync(join(tmpdir(), "scenefile-broken-"));
    try {
      const good = readFileSync(join(baseDir, "assets", "small.png"));
      // A real header followed by a truncated body: what a half-finished download looks like.
      writeFileSync(join(folder, "cut.png"), Buffer.concat([good.subarray(0, 60), Buffer.alloc(40)]));
      const result = await checkWithAssets(
        { version: 1, scenes: [{ type: "screenshot", src: "cut.png", caption: "A caption." }, filler] },
        { baseDir: folder },
      );
      if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
      const report = await inspectComposition(result.composition);
      expect(report.broken).toEqual(["scenes[0].src"]);
      const laidOut = applyLayout(result, report);
      expect(laidOut.ok).toBe(false);
      expect(laidOut.diagnostics.map((d) => [d.code, d.path])).toEqual([["ASSET_UNSUPPORTED", "scenes[0].src"]]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("reports callout labels that overlap each other, the caption, or the address bar", async () => {
    const shot = (callouts: unknown[]) => ({ type: "screenshot", src: "assets/shot.png", url: "scenefile.dev", caption: "A caption under the image.", callouts });
    const { composition } = await compose({
      scenes: [
        shot([{ x: 0.4, y: 0.5, label: "First label here" }, { x: 0.42, y: 0.52, label: "Second label here" }]),
        shot([{ x: 0.1, y: 1, label: "Sits on the caption line below" }]),
        shot([{ x: 0.3, y: 0, label: "Covers the address bar" }]),
        shot([{ x: 0.2, y: 0.3, label: "Fine" }, { x: 0.7, y: 0.7, label: "Also fine" }]),
      ],
    });
    const report = await inspectComposition(composition);
    const conflicts = (report.conflicts ?? []).map((conflict) => [conflict.path, conflict.with]);
    expect(conflicts).toContainEqual(["scenes[0].callouts[1].label", "scenes[0].callouts[0].label"]);
    expect(conflicts).toContainEqual(["scenes[1].callouts[0].label", "scenes[1].caption"]);
    expect(conflicts).toContainEqual(["scenes[2].callouts[0].label", "scenes[2].url"]);
    expect(conflicts.filter(([path]) => path?.startsWith("scenes[3]"))).toEqual([]);
    expect(report.labels?.filter((label) => label.path.startsWith("scenes[3].callouts"))).toHaveLength(2);
    const codes = verifyLayout(report).filter((d) => d.severity === "error").map((d) => d.code);
    expect(new Set(codes)).toEqual(new Set(["LABEL_OVERLAP"]));
  });
});
