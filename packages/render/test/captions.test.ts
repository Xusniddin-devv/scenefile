import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWithAssets } from "@scenefile/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureFrame, openComposition } from "../src/index";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-captions-"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=1600x1000", "-frames:v", "1", join(dir, "shot.png")]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const say = "This is what the narrator says while the scene is on screen.";
const scenes = [
  { type: "title", heading: "Your database, saved in one command", sub: "It takes a snapshot and brings it back." },
  { type: "screenshot", src: "shot.png", url: "example.com", caption: "The dashboard after a restore." },
  { type: "compare", before: { label: "Before", src: "shot.png" }, after: { label: "After", src: "shot.png" } },
  { type: "chart", heading: "Build time", unit: "s", bars: [{ label: "Before", value: 48 }, { label: "After", value: 3 }] },
  { type: "terminal", steps: [{ run: "pgsnap save", output: "Saved." }] },
  { type: "outro", heading: "Never lose a database again.", command: "npm install -g pgsnap" },
].map((scene) => ({ ...scene, say, transition: "cut" }));

async function open(format: string, captions = true) {
  const result = await checkWithAssets(
    { version: 1, format, voice: { name: "en-kristin", captions }, scenes },
    { baseDir: dir, speak: async () => ({ file: "/nowhere.wav", seconds: 3 }) },
  );
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return { manifest: result.composition.manifest, session: await openComposition(result.composition) };
}

describe("captions on screen", () => {
  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])("%s: one caption while the voice speaks, and no scene content under the band", async (format) => {
    const { manifest, session } = await open(format);
    try {
      for (const scene of manifest.scenes) {
        // Two seconds in: the voice began half a second in and speaks for three.
        await captureFrame(session.page, scene.startFrame + 60);
        const seen = await session.page.evaluate(() => {
          const band = document.querySelector(".sf-captions")?.getBoundingClientRect();
          const cues = Array.from(document.querySelectorAll<HTMLElement>("[data-sf-cue]:not([hidden])"));
          const cue = cues[0]?.getBoundingClientRect();
          const visible = document.querySelector<HTMLElement>(".sf-scene:not([hidden])");
          // The lowest thing drawn in the scene: text, images and boxes alike.
          const lowest = Math.max(
            ...Array.from(visible?.querySelectorAll<HTMLElement>("*") ?? [])
              .filter((el) => el.children.length === 0 && el.getBoundingClientRect().height > 0)
              .map((el) => el.getBoundingClientRect().bottom),
          );
          return {
            type: visible?.dataset.sfType,
            cues: cues.length,
            bandTop: band?.top ?? 0,
            bandBottom: band?.bottom ?? 0,
            cueTop: cue?.top ?? 0,
            cueBottom: cue?.bottom ?? 0,
            cueRight: cue?.right ?? 0,
            cueScroll: cues[0] ? cues[0].scrollHeight - cues[0].clientHeight : 0,
            lowest,
            width: window.innerWidth,
          };
        });
        expect(seen.cues, seen.type).toBe(1);
        expect(seen.lowest, `${seen.type}: content under the caption band`).toBeLessThanOrEqual(seen.bandTop + 0.5);
        expect(seen.cueTop).toBeGreaterThanOrEqual(seen.bandTop);
        expect(seen.cueBottom).toBeLessThanOrEqual(seen.bandBottom);
        expect(seen.cueRight).toBeLessThanOrEqual(seen.width);
        expect(seen.cueScroll, "caption text cut off").toBeLessThanOrEqual(1);
      }
      // Before the voice starts there is nothing to read.
      await captureFrame(session.page, 5);
      expect(await session.page.evaluate(() => document.querySelectorAll("[data-sf-cue]:not([hidden])").length)).toBe(0);
    } finally {
      await session.close();
    }
  });

  it("leaves the frame whole when captions are off", async () => {
    const { session } = await open("landscape-1080p", false);
    try {
      await captureFrame(session.page, 60);
      const state = await session.page.evaluate(() => ({
        band: document.querySelector(".sf-captions") !== null,
        sceneBottom: document.querySelector(".sf-scene:not([hidden])")?.getBoundingClientRect().bottom,
      }));
      expect(state).toEqual({ band: false, sceneBottom: 1080 });
    } finally {
      await session.close();
    }
  });
});

describe("a chart that tells the truth", () => {
  it.each(["landscape-1080p", "portrait-1080p"])("%s: a larger value always draws a longer bar, on tracks of one width", async (format) => {
    const bars = [
      { label: "Theirs", value: 1_000_000 },
      { label: "Ours", value: 950_000 },
      { label: "Small", value: 9_999 },
      { label: "Tiny", value: 0.5 },
      { label: "None", value: 0 },
    ];
    const result = await checkWithAssets(
      { version: 1, format, scenes: [{ type: "chart", unit: "ms", bars, highlight: "Ours", duration: 6 }, { type: "title", heading: "End" }] },
      { baseDir: dir },
    );
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const session = await openComposition(result.composition);
    try {
      await captureFrame(session.page, 150);
      const rows = await session.page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".sf-chart__row"), (row) => {
          const track = row.querySelector(".sf-chart__track")?.getBoundingClientRect();
          const value = row.querySelector(".sf-chart__value")?.getBoundingClientRect();
          return {
            track: track?.width ?? 0,
            trackRight: track?.right ?? 0,
            fill: row.querySelector(".sf-chart__fill")?.getBoundingClientRect().width ?? 0,
            valueLeft: value?.left ?? 0,
            valueTop: value?.top ?? 0,
            trackBottom: track?.bottom ?? 0,
          };
        }),
      );
      const [theirs, ours, small, tiny, none] = rows;
      for (const row of rows) expect(row.track).toBeCloseTo(theirs?.track ?? 0, 0);
      expect(theirs?.track).toBeGreaterThan(100);
      expect(theirs?.fill).toBeGreaterThan(ours?.fill ?? 0);
      expect(ours?.fill).toBeGreaterThan(small?.fill ?? 0);
      expect(small?.fill).toBeGreaterThanOrEqual(tiny?.fill ?? 0);
      // Something is not nothing: a value above zero can be seen, and zero cannot.
      expect(tiny?.fill).toBeGreaterThanOrEqual(3);
      expect(none?.fill).toBe(0);
      for (const row of rows) expect(row.valueLeft >= row.trackRight - 0.5 || row.valueTop >= row.trackBottom - 0.5).toBe(true);
    } finally {
      await session.close();
    }
  });
});
