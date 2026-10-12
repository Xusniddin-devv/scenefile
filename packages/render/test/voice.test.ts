import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "@scenefile/engine";
import { VOICES } from "@scenefile/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VOICE_CATALOG, createSpeaker, installVoice, probeVideo, renderVideo, voiceHome, voiceInstalled } from "../src/index";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-voice-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in for the speech engine: a tone whose length follows the text's. */
function fakeVoice(calls: string[] = []) {
  return (_folder: string, model: string, text: string) => {
    calls.push(`${model}: ${text}`);
    const samples = new Float32Array(Math.round((text.length / 10) * 22050));
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 8) * 0.4;
    return { samples, sampleRate: 22050 };
  };
}

/** What an unpacked voice holds. */
function fill(folder: string, model: string, parts = [`${model}.onnx`, "tokens.txt", "espeak-ng-data/phontab"]): void {
  for (const part of parts) {
    mkdirSync(join(folder, part, ".."), { recursive: true });
    writeFileSync(join(folder, part), "");
  }
}

/** A home folder in which the given voices look installed. */
function homeWith(...names: (keyof typeof VOICE_CATALOG)[]): string {
  const home = mkdtempSync(join(dir, "home-"));
  for (const name of names) {
    const model = VOICE_CATALOG[name].model;
    fill(join(home, "voices", `vits-piper-${model}`), model);
  }
  return home;
}

describe("making the voice", () => {
  it("saves each line as a sound file and knows how long it is", async () => {
    const calls: string[] = [];
    const speak = createSpeaker({ home: homeWith("en-joe", "en-kristin"), download: false, synthesize: fakeVoice(calls) });
    const first = await speak("Twenty characters...", "en-joe");
    expect(first.seconds).toBeCloseTo(2, 3);
    expect(readFileSync(first.file).subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(calls).toEqual(["en_US-joe-medium: Twenty characters..."]);

    // The same line in the same voice is read back, not made again; another voice is another file.
    expect(await speak("Twenty characters...", "en-joe")).toEqual(first);
    expect(calls).toHaveLength(1);
    expect((await speak("Twenty characters...", "en-kristin")).file).not.toBe(first.file);
    expect(calls).toHaveLength(2);
  });

  it("says how to install a voice it may not download", async () => {
    const speak = createSpeaker({ home: homeWith(), download: false, synthesize: fakeVoice() });
    await expect(speak("Hello.", "ru-denis")).rejects.toThrow("scenefile voices install ru-denis");
  });

  it("uses a download only if it is exactly the file expected", async () => {
    const home = homeWith();
    const unpacked: string[] = [];
    const install = {
      fetch: (async () => new Response("not the voice")) as typeof fetch,
      unpack: async (archive: string) => void unpacked.push(archive),
    };
    const announced: string[] = [];
    const speak = createSpeaker({ home, download: true, synthesize: fakeVoice(), install, onDownload: (name) => void announced.push(name) });
    await expect(speak("Hello.", "en-joe")).rejects.toThrow(/not the file that was expected/);
    expect(announced).toEqual(["en-joe"]);
    expect(unpacked).toEqual([]);
    expect(readdirSync(join(home, "voices"))).toEqual([]);
  });

  it("installs a voice from its fixed address, and only once it is whole", async () => {
    const body = "the archive";
    const info = { ...VOICE_CATALOG["en-joe"], sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length };
    const asked: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return new Response(body);
    }) as typeof fetch;

    // An unpack that stops half way leaves nothing that looks installed.
    const half = join(homeWith(), "voices");
    const broken = installVoice("en-joe", { voicesDir: half, info, fetch: fetcher, unpack: async (_archive, into) => fill(join(into, `vits-piper-${info.model}`), info.model, [`${info.model}.onnx`]) });
    await expect(broken).rejects.toThrow(/could not be unpacked/);
    expect(voiceInstalled(half, "en-joe")).toBe(false);
    expect(readdirSync(half)).toEqual([]);

    const whole = join(homeWith(), "voices");
    await installVoice("en-joe", { voicesDir: whole, info, fetch: fetcher, unpack: async (_archive, into) => fill(join(into, `vits-piper-${info.model}`), info.model) });
    expect(voiceInstalled(whole, "en-joe")).toBe(true);
    expect(readdirSync(whole)).toEqual([`vits-piper-${info.model}`]);
    expect(new Set(asked)).toEqual(new Set(["https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-joe-medium.tar.bz2"]));

    // A download larger than the voice is known to be is cut off, not saved.
    const huge = installVoice("en-bryce", { voicesDir: whole, info: { ...info, model: "en_US-bryce-medium", bytes: 4 }, fetch: fetcher, unpack: async () => undefined });
    await expect(huge).rejects.toThrow(/larger than expected|not the file/);
  });

  it("does not count a voice with files missing as installed", () => {
    const home = homeWith();
    fill(join(home, "voices", "vits-piper-en_US-joe-medium"), "en_US-joe-medium", ["en_US-joe-medium.onnx"]);
    expect(voiceInstalled(join(home, "voices"), "en-joe")).toBe(false);
  });

  it("makes a line again when what it saved is damaged", async () => {
    const calls: string[] = [];
    const home = homeWith("en-joe");
    const speak = createSpeaker({ home, download: false, synthesize: fakeVoice(calls) });
    const first = await speak("Twenty characters...", "en-joe");
    writeFileSync(`${first.file}.json`, '{"seconds":"soon"}');
    expect((await speak("Twenty characters...", "en-joe")).seconds).toBeCloseTo(2, 3);
    rmSync(first.file);
    expect(existsSync((await speak("Twenty characters...", "en-joe")).file)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("keeps saved lines under a size limit by dropping the oldest", async () => {
    const home = homeWith("en-joe");
    // Each one-second line is about 44 kB.
    const speak = createSpeaker({ home, download: false, synthesize: fakeVoice(), maxCacheBytes: 100_000 });
    const lines = [];
    for (const text of ["First one", "Second one", "Third line"]) {
      lines.push(await speak(text.padEnd(10, "."), "en-joe"));
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(lines.map((line) => existsSync(line.file))).toEqual([false, true, true]);
  });

  it("offers a natural English voice of each sex from one shared model, and tells them apart", async () => {
    const emma = VOICE_CATALOG["en-emma"];
    const george = VOICE_CATALOG["en-george"];
    expect([emma.describes, george.describes]).toEqual(["woman, British", "man, British"]);
    expect(emma.folder).toBe(george.folder);
    expect(emma.speaker).not.toBe(george.speaker);
    // One download serves both.
    const home = mkdtempSync(join(dir, "home-"));
    for (const part of ["model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data/phontab"]) {
      mkdirSync(join(home, "voices", emma.folder ?? "", part, ".."), { recursive: true });
      writeFileSync(join(home, "voices", emma.folder ?? "", part), "");
    }
    expect(voiceInstalled(join(home, "voices"), "en-emma")).toBe(true);
    expect(voiceInstalled(join(home, "voices"), "en-george")).toBe(true);
    const asked: (number | undefined)[] = [];
    const speak = createSpeaker({
      home,
      download: false,
      synthesize: (_folder, _model, text, info) => {
        asked.push(info?.speaker);
        return fakeVoice()(_folder, _model, text);
      },
    });
    const a = await speak("The same words.", "en-emma");
    const b = await speak("The same words.", "en-george");
    expect(a.file).not.toBe(b.file);
    expect(asked).toEqual([emma.speaker, george.speaker]);
  });

  it.skipIf(!voiceInstalled(join(voiceHome(), "voices"), "en-emma"))("speaks in the natural voice for real when it is installed", async () => {
    const line = await createSpeaker({ download: false })("Scenefile turns a short script into a finished video.", "en-george");
    expect(line.seconds).toBeGreaterThan(1.5);
    expect(line.seconds).toBeLessThan(8);
  });

  it("says where each voice comes from, and the catalog matches what a scenefile can name", () => {
    expect(Object.keys(VOICE_CATALOG).sort()).toEqual([...VOICES].sort());
    expect(VOICE_CATALOG["en-kristin"].basis).toMatch(/public-domain/);
    for (const name of ["en-joe", "ru-denis", "ru-dmitri"] as const) expect(VOICE_CATALOG[name].basis).toMatch(/research/);
  });

  it.skipIf(!voiceInstalled(join(voiceHome(), "voices"), "en-joe"))("speaks for real when the voice is installed", async () => {
    const real = createSpeaker({ download: false });
    const line = await real("Scenefile turns a short script into a finished video.", "en-joe");
    expect(line.seconds).toBeGreaterThan(1.5);
    expect(line.seconds).toBeLessThan(8);
    expect(readFileSync(line.file).length).toBeGreaterThan(40_000);
  });
});

function loudness(file: string, from: number, seconds: number): number {
  const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(seconds), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" });
  const found = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr)?.[1];
  if (found === undefined) throw new Error(`no volume measurement in:\n${stderr}`);
  return found === "-inf" ? -200 : Number(found);
}

describe("rendering with narration", () => {
  const scenefile = {
    version: 1,
    transition: "cut",
    scenes: [
      { type: "title", heading: "One", say: "First line of narration here." },
      { type: "title", heading: "Two", say: "Second line." },
    ],
  };

  async function clips(): Promise<Map<number, { file: string; seconds: number }>> {
    const speak = createSpeaker({ home: homeWith("en-joe"), download: false, synthesize: fakeVoice() });
    // Twenty characters make two seconds; ten make one.
    return new Map([[0, await speak("First line, 20 chars", "en-joe")], [1, await speak("Second one", "en-joe")]]);
  }

  it("plays each line when its scene is on screen and is quiet in between", async () => {
    const result = check(scenefile, { assets: new Map(), diagnostics: [], speech: await clips() });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const [first, second] = result.composition.narration ?? [];
    const output = join(dir, "narrated.mp4");
    const report = await renderVideo(result.composition, { output, quality: "draft" });
    expect(report.audio).toBe(true);
    const probed = await probeVideo(output);
    expect(probed.frames).toBe(result.composition.manifest.totalFrames);
    expect(probed.audio).toBe(true);

    const during = loudness(output, (first?.atSeconds ?? 0) + 0.5, 1);
    expect(during).toBeGreaterThan(-30);
    expect(loudness(output, 0, 0.3)).toBeLessThan(during - 30);
    // After the first line ends and before the second begins.
    expect(loudness(output, (first?.atSeconds ?? 0) + 2.1, 0.2)).toBeLessThan(during - 30);
    expect(loudness(output, (second?.atSeconds ?? 0) + 0.2, 0.6)).toBeGreaterThan(-30);
  });

  it("turns the music down while someone is speaking", async () => {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=30", join(dir, "bed.mp3")]);
    const silent = check({ ...scenefile, scenes: scenefile.scenes.map(({ say: _say, ...scene }) => ({ ...scene, duration: 4 })) });
    if (!silent.composition) throw new Error(JSON.stringify(silent.diagnostics));
    const audio = { file: join(dir, "bed.mp3"), volume: 0.5 };
    const alone = join(dir, "music-alone.mp4");
    const ducked = join(dir, "music-ducked.mp4");
    await renderVideo({ ...silent.composition, audio }, { output: alone, quality: "draft" });
    // The same picture and music, with a voice (a high tone) from 3s to 5s.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=1000:duration=2", "-ar", "24000", "-ac", "1", join(dir, "voice.wav")]);
    await renderVideo(
      { ...silent.composition, audio, narration: [{ file: join(dir, "voice.wav"), atSeconds: 3, seconds: 2 }] },
      { output: ducked, quality: "draft" },
    );
    // Compare only the music's own pitch, before the voice and under it.
    const band = (file: string, from: number): number => {
      const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", "1", "-i", file, "-af", "bandpass=f=220:width_type=h:w=40,volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" });
      return Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)?.[1] ?? Number.NaN);
    };
    expect(band(ducked, 1.5)).toBeCloseTo(band(alone, 1.5), 0);
    expect(band(ducked, 3.8)).toBeLessThan(band(alone, 3.8) - 6);
    expect(existsSync(ducked)).toBe(true);
  });
});
