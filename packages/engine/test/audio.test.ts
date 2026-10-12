import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalize } from "@scenefile/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES, loadAudio } from "../src/assets";
import { check, checkWithAssets } from "../src/check";

const scenes = [{ type: "title", heading: "one two three", sub: "four five six" }];

describe("the music bed", () => {
  let root: string;
  let baseDir: string;
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "scenefile-audio-")));
    baseDir = join(root, "project");
    mkdirSync(baseDir);
    mkdirSync(join(root, "outside"));
    writeFileSync(join(baseDir, "bed.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "frames.mp3"), Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.wav"), Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.m4a"), Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.ogg"), Buffer.concat([Buffer.from("OggS"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.flac"), Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "notes.mp3"), "these are not sounds");
    writeFileSync(join(baseDir, "huge.mp3"), "ID3");
    truncateSync(join(baseDir, "huge.mp3"), MAX_AUDIO_BYTES + 1);
    writeFileSync(join(root, "outside", "secret.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
    symlinkSync(join(root, "outside", "secret.mp3"), join(baseDir, "link.mp3"));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const parsed = (audio: unknown) => {
    const { scenefile, diagnostics } = normalize({ version: 1, audio, scenes });
    if (!scenefile) throw new Error(JSON.stringify(diagnostics));
    return scenefile;
  };
  const load = (audio: unknown) => loadAudio(parsed(audio), { baseDir });

  it("defaults the volume, and keeps it between silent and full", () => {
    expect(parsed({ src: "bed.mp3" }).audio).toEqual({ src: "bed.mp3", volume: 0.4 });
    expect(normalize({ version: 1, audio: { src: "bed.mp3", volume: 1.5 }, scenes }).scenefile).toBeNull();
    expect(normalize({ version: 1, audio: { src: "bed.mp3", loop: true }, scenes }).scenefile).toBeNull();
  });

  it.each(["bed.mp3", "frames.mp3", "bed.wav", "bed.m4a", "bed.ogg", "bed.flac"])("accepts %s", async (src) => {
    const { audio, diagnostics } = await load({ src, volume: 0.25 });
    expect(diagnostics).toEqual([]);
    expect(audio).toEqual({ file: join(baseDir, src), volume: 0.25 });
  });

  it("has nothing to load when the scenefile names no music", async () => {
    const { scenefile } = normalize({ version: 1, scenes });
    if (!scenefile) throw new Error("invalid");
    expect(await loadAudio(scenefile, { baseDir })).toEqual({ audio: null, diagnostics: [] });
  });

  it.each([
    ["nope.mp3", "ASSET_NOT_FOUND", /no file/],
    ["../outside/secret.mp3", "ASSET_NOT_FOUND", /outside/],
    ["link.mp3", "ASSET_NOT_FOUND", /outside/],
    ["https://example.com/bed.mp3", "ASSET_NOT_FOUND", /local file|folder/],
    ["notes.mp3", "ASSET_UNSUPPORTED", /MP3|WAV/],
    ["huge.mp3", "ASSET_TOO_LARGE", /30 MB/],
  ])("refuses %s", async (src, code, message) => {
    const { audio, diagnostics } = await load({ src });
    expect(audio).toBeNull();
    expect(diagnostics).toEqual([expect.objectContaining({ code, severity: "error", path: "audio.src" })]);
    expect(diagnostics[0]?.message).toMatch(message);
  });

  it.skipIf(process.getuid?.() === 0)("reports a music file it is not allowed to read", async () => {
    writeFileSync(join(baseDir, "locked.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
    chmodSync(join(baseDir, "locked.mp3"), 0o000);
    const { audio, diagnostics } = await load({ src: "locked.mp3" });
    expect(audio).toBeNull();
    expect(diagnostics).toEqual([expect.objectContaining({ code: "ASSET_NOT_FOUND", path: "audio.src" })]);
    expect(diagnostics[0]?.message).toMatch(/could not be read/);
  });

  it("carries the music into the composition and mentions it in the storyboard", async () => {
    const result = await checkWithAssets({ version: 1, audio: { src: "bed.mp3" }, scenes }, { baseDir });
    expect(result.ok).toBe(true);
    expect(result.composition?.audio).toEqual({ file: join(baseDir, "bed.mp3"), volume: 0.4 });
    expect(result.storyboard.split("\n")[0]).toMatch(/, 1 scenes, music$/);
    const silent = await checkWithAssets({ version: 1, scenes }, { baseDir });
    expect(silent.composition?.audio).toBeUndefined();
    expect(silent.storyboard.split("\n")[0]).not.toContain("music");
  });

  it("fails a check that names music which was never loaded, or which could not be", async () => {
    const unloaded = check({ version: 1, audio: { src: "bed.mp3" }, scenes });
    expect(unloaded.ok).toBe(false);
    expect(unloaded.diagnostics).toEqual([expect.objectContaining({ code: "ASSET_NOT_FOUND", path: "audio.src" })]);
    const missing = await checkWithAssets({ version: 1, audio: { src: "nope.mp3" }, scenes }, { baseDir });
    expect(missing.ok).toBe(false);
    expect(missing.composition).toBeNull();
  });
});
