import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareScenefile, probeClip, probeVideo, renderVideo } from "../src/index";

let dir: string;
const make = (name: string, source: string, seconds: number, sound: boolean): void => {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", `${source}:d=${seconds}:r=25`,
    ...(sound ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`] : []),
    "-pix_fmt", "yuv420p", "-shortest", join(dir, name),
  ]);
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-clips-"));
  make("red.mp4", "color=c=red:s=640x360", 4, true);
  make("blue.mp4", "color=c=blue:s=360x640", 3, false);
  writeFileSync(join(dir, "notes.mp4"), "just text");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The color of one point of the picture at a time, as [red, green, blue]. */
function pixel(file: string, seconds: number, x: number, y: number): number[] {
  const { stdout } = spawnSync("ffmpeg", ["-loglevel", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...stdout.subarray(0, 3)];
}
function loudness(file: string, from: number, seconds: number): number {
  const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(seconds), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" });
  const found = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  return found === undefined || found === "-inf" ? -200 : Number(found);
}
const isRed = ([r = 0, g = 0, b = 0]: number[]) => r > 180 && g < 80 && b < 80;
const isBlue = ([r = 0, g = 0, b = 0]: number[]) => b > 180 && r < 80 && g < 80;

async function render(name: string, scenes: unknown[]) {
  const result = await prepareScenefile({ version: 1, scenes }, { baseDir: dir });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  const output = join(dir, name);
  const report = await renderVideo(result.composition, { output, quality: "draft" });
  return { output, report, composition: result.composition };
}

describe("reading a clip", () => {
  it("finds its size, length and whether it has sound", async () => {
    expect(await probeClip(join(dir, "red.mp4"))).toMatchObject({ width: 640, height: 360, audio: true });
    expect((await probeClip(join(dir, "red.mp4")))?.seconds).toBeCloseTo(4, 1);
    expect(await probeClip(join(dir, "blue.mp4"))).toMatchObject({ width: 360, height: 640, audio: false });
    expect(await probeClip(join(dir, "notes.mp4"))).toBeNull();
  });
});

describe("rendering clips", () => {
  it("shows the chosen part of the clip in its place, with its sound, between other scenes", async () => {
    const { output, report, composition } = await render("mixed.mp4", [
      { type: "title", heading: "Before", duration: 2 },
      { type: "clip", src: "red.mp4", from: 1, to: 3 },
      { type: "title", heading: "After", duration: 2 },
    ]);
    const placed = composition.clips?.[0];
    if (!placed) throw new Error("no clip placed");
    const probed = await probeVideo(output);
    expect(probed.frames).toBe(composition.manifest.totalFrames);
    expect(report.audio).toBe(true);
    const centre: [number, number] = [Math.round(placed.x + placed.width / 2), Math.round(placed.y + placed.height / 2)];
    expect(isRed(pixel(output, placed.atSeconds + 1, ...centre))).toBe(true);
    // First and last frames of the clip's scene are the clip; the scenes around it are not.
    expect(isRed(pixel(output, placed.atSeconds + 0.02, ...centre))).toBe(true);
    expect(isRed(pixel(output, placed.atSeconds + placed.seconds - 0.05, ...centre))).toBe(true);
    expect(isRed(pixel(output, placed.atSeconds - 0.1, ...centre))).toBe(false);
    expect(isRed(pixel(output, placed.atSeconds + placed.seconds + 0.1, ...centre))).toBe(false);
    // Outside the clip's box the frame is still the scene's own background.
    expect(isRed(pixel(output, placed.atSeconds + 1, 10, 1070))).toBe(false);
    expect(loudness(output, placed.atSeconds + 0.5, 1)).toBeGreaterThan(-40);
    expect(loudness(output, 0.2, 1)).toBeLessThan(-60);
  });

  it("keeps the clip's sound alongside music", async () => {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=20", join(dir, "bed.mp3")]);
    const result = await prepareScenefile(
      { version: 1, audio: { src: "bed.mp3", volume: 0.05 }, scenes: [{ type: "title", heading: "Before", duration: 2 }, { type: "clip", src: "red.mp4", to: 2 }] },
      { baseDir: dir },
    );
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, "with-music.mp4");
    await renderVideo(result.composition, { output, quality: "draft" });
    const start = result.composition.clips?.[0]?.atSeconds ?? 0;
    // Quiet music alone, then the clip's much louder tone on top of it.
    expect(loudness(output, start + 0.5, 1)).toBeGreaterThan(loudness(output, 0.5, 1) + 10);
    expect((await probeVideo(output)).durationSeconds).toBeCloseTo(result.composition.manifest.totalFrames / 30, 1);
  });

  it("joins clips of different shapes end to end, filling the frame when asked", async () => {
    const { output, composition } = await render("joined.mp4", [
      { type: "clip", src: "red.mp4", to: 2, fit: "cover", volume: 0 },
      { type: "clip", src: "blue.mp4", fit: "cover" },
    ]);
    const [first, second] = composition.clips ?? [];
    expect(second?.atSeconds).toBeCloseTo((first?.atSeconds ?? 0) + 2, 5);
    expect(isRed(pixel(output, 1, 5, 5))).toBe(true);
    expect(isBlue(pixel(output, 2.5, 1900, 1070))).toBe(true);
    expect((await probeVideo(output)).audio).toBe(false);
  });
});
