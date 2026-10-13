import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareScenefile, probeClip, probeVideo, renderVideo, runFfmpeg } from "../src/index";

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

/** Where the file's sound track starts and how long it lasts, as the file itself says. */
function soundTrack(file: string): { start: number; seconds: number } {
  const { stdout } = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=start_time,duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [start = "NaN", seconds = "NaN"] = stdout.trim().split(",");
  return { start: Number(start), seconds: Number(seconds) };
}

describe("files that only look like video", () => {
  it("does not follow a playlist to files outside the folder", async () => {
    const outside = mkdtempSync(join(tmpdir(), "scenefile-outside-"));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=320x180:d=2", "-f", "mpegts", join(outside, "secret.ts")]);
    writeFileSync(join(dir, "list.m3u8"), `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${join(outside, "secret.ts")}\n#EXT-X-ENDLIST\n`);
    writeFileSync(join(dir, "list.mp4"), `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${join(outside, "secret.ts")}\n#EXT-X-ENDLIST\n`);
    expect(await probeClip(join(dir, "list.m3u8"))).toBeNull();
    expect(await probeClip(join(dir, "list.mp4"))).toBeNull();
    rmSync(outside, { recursive: true, force: true });
  });

  it("reads the length of a recording that does not state one, and says when footage is HDR or oddly shaped", async () => {
    // What a browser's recorder writes: WebM with no length in its header.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=3:r=25", "-c:v", "libvpx", "-b:v", "200k", "-f", "webm", "-live", "1", join(dir, "live.webm")]);
    expect((await probeClip(join(dir, "live.webm")))?.seconds).toBeCloseTo(3, 0);
    // Pixels that are not square: 4:3 pixels make a 720-wide picture 960 wide when shown.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=720x540:d=1:r=25", "-vf", "setsar=4/3", "-pix_fmt", "yuv420p", join(dir, "wide-pixels.mp4")]);
    expect(await probeClip(join(dir, "wide-pixels.mp4"))).toMatchObject({ width: 960, height: 540 });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=1:r=25", "-vf", "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc", "-pix_fmt", "yuv420p", join(dir, "hdr.mp4")]);
    expect((await probeClip(join(dir, "hdr.mp4")))?.hdr).toBe(true);
    expect((await probeClip(join(dir, "red.mp4")))?.hdr).toBe(false);
  });
});

describe("running ffmpeg with a time limit", () => {
  it("accepts a limit that is not a whole number of milliseconds", async () => {
    // A video 25.37 seconds long gives a limit like 1014666.67; that must not be an error.
    await expect(runFfmpeg(["-version"], "ffmpeg", { timeoutMs: 1014666.6666666667 })).resolves.toBeUndefined();
  });
});

describe("rendering clips", () => {
  it("keeps the sound whole and in place when clips are cut from the middle of their files", async () => {
    make("low.mp4", "color=c=red:s=640x360", 5, true);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=4:r=25", "-f", "lavfi", "-i", "sine=frequency=1760:duration=4", "-pix_fmt", "yuv420p", "-shortest", join(dir, "high.mp4")]);
    const { output, composition } = await render("two-cuts.mp4", [
      { type: "title", heading: "Before", duration: 2 },
      { type: "clip", src: "low.mp4", from: 2, to: 4 },
      { type: "clip", src: "high.mp4", from: 1, to: 3 },
      { type: "title", heading: "After", duration: 2 },
    ]);
    const track = soundTrack(output);
    expect(Math.abs(track.start)).toBeLessThan(0.05);
    expect(track.seconds).toBeCloseTo(composition.manifest.totalFrames / 30, 1);
    const tone = (hertz: number, from: number): number => {
      const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", "1", "-i", output, "-af", `bandpass=f=${hertz}:width_type=h:w=${hertz / 8},volumedetect`, "-vn", "-f", "null", "-"], { encoding: "utf8" });
      const found = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
      return found === undefined || found === "-inf" ? -200 : Number(found);
    };
    const [first, second] = composition.clips ?? [];
    // Each clip's own tone is heard during that clip and not during the other, nor before either.
    expect(tone(440, (first?.atSeconds ?? 0) + 0.5)).toBeGreaterThan(-40);
    expect(tone(1760, (second?.atSeconds ?? 0) + 0.5)).toBeGreaterThan(-40);
    // A narrow filter still lets a little of a loud neighbouring tone through.
    expect(tone(1760, (first?.atSeconds ?? 0) + 0.5)).toBeLessThan(-50);
    expect(tone(440, (second?.atSeconds ?? 0) + 0.5)).toBeLessThan(-50);
    expect(loudness(output, 0.3, 1)).toBeLessThan(-60);
  });

  it("never lets the sound added together go past full scale", async () => {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=3:r=25", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-af", "volume=18dB", "-pix_fmt", "yuv420p", "-shortest", join(dir, "shout.mp4")]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=500:duration=10", "-af", "volume=18dB", join(dir, "loud-bed.wav")]);
    const result = await prepareScenefile({ version: 1, audio: { src: "loud-bed.wav", volume: 1 }, scenes: [{ type: "clip", src: "shout.mp4" }] }, { baseDir: dir });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, "loud.mp4");
    await renderVideo(result.composition, { output, quality: "draft" });
    const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-i", output, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" });
    expect(Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1])).toBeLessThanOrEqual(-0.2);
  });

  it("stops when told to while footage is being laid in, and writes nothing", async () => {
    make("long.mp4", "testsrc2=s=1280x720", 12, false);
    const result = await prepareScenefile({ version: 1, scenes: [{ type: "clip", src: "long.mp4" }] }, { baseDir: dir });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, "stopped.mp4");
    const stopper = new AbortController();
    const total = result.composition.manifest.totalFrames;
    const attempt = renderVideo(result.composition, {
      output,
      quality: "draft",
      signal: stopper.signal,
      // Every frame of the page is drawn; what remains is laying in the footage.
      onProgress: (done) => {
        if (done === total) setTimeout(() => stopper.abort(), 400);
      },
    });
    await expect(attempt).rejects.toThrow(/cancelled/);
    expect(existsSync(output)).toBe(false);
  });


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

describe("clip effects, rendered", () => {
  const grey = ([r = 0, g = 0, b = 0]: number[]) => Math.abs(r - g) < 12 && Math.abs(g - b) < 12;

  it("plays at double speed: the second half of the footage arrives in half the time, and the sound is whole", async () => {
    // Two seconds of red, then two of blue, with a tone throughout.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=640x360:d=2:r=25", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=2:r=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-pix_fmt", "yuv420p", join(dir, "halves.mp4")]);
    const { output, composition } = await render("fast.mp4", [{ type: "clip", src: "halves.mp4", speed: 2, fit: "cover" }, { type: "title", heading: "After", duration: 2 }]);
    expect(composition.clips?.[0]?.seconds).toBeCloseTo(2, 1);
    expect(isRed(pixel(output, 0.5, 960, 540))).toBe(true);
    expect(isBlue(pixel(output, 1.5, 960, 540))).toBe(true);
    expect(isBlue(pixel(output, 2.5, 960, 540))).toBe(false);
    const track = soundTrack(output);
    expect(Math.abs(track.start)).toBeLessThan(0.05);
    expect(loudness(output, 0.3, 1.4)).toBeGreaterThan(-40);
    expect(loudness(output, 2.6, 1)).toBeLessThan(-60);
  });

  it("can be drawn in black and white", async () => {
    const { output, composition } = await render("mono.mp4", [{ type: "clip", src: "red.mp4", to: 2, mono: true }, { type: "title", heading: "After", duration: 2 }]);
    const placed = composition.clips?.[0];
    const seen = pixel(output, 1, Math.round((placed?.x ?? 0) + (placed?.width ?? 0) / 2), Math.round((placed?.y ?? 0) + (placed?.height ?? 0) / 2));
    expect(grey(seen)).toBe(true);
    expect(isRed(seen)).toBe(false);
  });

  it("zooms in slowly: what is at the centre grows", async () => {
    // A white square on black, a quarter of the picture wide.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:d=4:r=25", "-vf", "drawbox=x=240:y=100:w=160:h=160:color=white:t=fill", "-pix_fmt", "yuv420p", join(dir, "square.mp4")]);
    const { output } = await render("zoom.mp4", [{ type: "clip", src: "square.mp4", fit: "cover", zoom: "in" }, { type: "title", heading: "After", duration: 2 }]);
    // Just outside the square's left edge at the start; inside it by the end.
    const edge = Math.round(1920 * (240 / 640)) - 14;
    const bright = ([r = 0]: number[]) => r > 180;
    expect(bright(pixel(output, 0.1, edge, 540))).toBe(false);
    expect(bright(pixel(output, 3.8, edge, 540))).toBe(true);
  });

  it("fills the sides of a tall clip with a blurred, darkened copy of itself", async () => {
    const { output, composition } = await render("backdrop.mp4", [{ type: "clip", src: "blue.mp4", backdrop: "blur" }, { type: "title", heading: "After", duration: 2 }]);
    const placed = composition.clips?.[0];
    expect(placed?.height).toBe(1080);
    const [r = 0, g = 0, b = 0] = pixel(output, 1, 40, 540);
    // Blue, but darker than the clip itself, where the page's black would otherwise be.
    expect(b).toBeGreaterThan(60);
    expect(b).toBeLessThan(200);
    expect(r + g).toBeLessThan(80);
    expect(isBlue(pixel(output, 1, 960, 540))).toBe(true);
  });
});
