import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWithAssets } from "@scenefile/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeVideo, renderVideo } from "../src/index";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-music-"));
  const tone = (name: string, seconds: number, hertz: number): void => {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${hertz}:duration=${seconds}`, join(dir, name)]);
  };
  tone("short.mp3", 1, 440);
  tone("long.wav", 20, 330);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const scenes = [
  { type: "title", heading: "one two three", sub: "four five six", duration: 3 },
  { type: "title", heading: "seven eight nine", duration: 3 },
];

/** Mean volume of a stretch of the file's sound, in dB. Silence is far below -60. */
function loudness(file: string, from: number, seconds: number): number {
  // ffmpeg reports measurements on its error stream.
  const { stderr } = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-ss", String(from), "-t", String(seconds), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const found = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  if (found === undefined) throw new Error(`no volume measurement in:\n${stderr}`);
  return found === "-inf" ? Number.NEGATIVE_INFINITY : Number(found);
}

describe("rendering with music", () => {
  it.each([
    ["short.mp3", "music shorter than the video is repeated"],
    ["long.wav", "music longer than the video is cut"],
  ])("%s: %s, to exactly the video's length, faded at both ends", async (src) => {
    const result = await checkWithAssets({ version: 1, transition: "fade", format: "square-1080p", audio: { src }, scenes }, { baseDir: dir });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, `with-${src}.mp4`);
    const report = await renderVideo(result.composition, { output, quality: "draft" });

    expect(report.audio).toBe(true);
    expect(report.frames).toBe(result.composition.manifest.totalFrames);
    const probed = await probeVideo(output);
    expect(probed.audio).toBe(true);
    expect(probed.frames).toBe(result.composition.manifest.totalFrames);
    expect(probed.durationSeconds).toBeCloseTo(6, 1);

    const middle = loudness(output, 2.5, 1);
    expect(middle).toBeGreaterThan(-45);
    // The last quarter second is the tail of the fade out: much quieter than the middle.
    expect(loudness(output, 5.75, 0.25)).toBeLessThan(middle - 12);
  });

  it("makes a quieter file for a lower volume, and a silent track for none", async () => {
    const render = async (volume: number): Promise<number> => {
      const result = await checkWithAssets({ version: 1, transition: "fade", format: "square-1080p", audio: { src: "long.wav", volume }, scenes }, { baseDir: dir });
      if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
      const output = join(dir, `volume-${volume}.mp4`);
      await renderVideo(result.composition, { output, quality: "draft" });
      return loudness(output, 2.5, 1);
    };
    const full = await render(1);
    const half = await render(0.5);
    expect(full - half).toBeGreaterThan(4);
    expect(full - half).toBeLessThan(8);
  });

  it("has no sound track when the scenefile names no music", async () => {
    const result = await checkWithAssets({ version: 1, transition: "fade", format: "square-1080p", scenes }, { baseDir: dir });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, "silent.mp4");
    const report = await renderVideo(result.composition, { output, quality: "draft" });
    expect(report.audio).toBe(false);
    expect((await probeVideo(output)).audio).toBe(false);
  });
});
