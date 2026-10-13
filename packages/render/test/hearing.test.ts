import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSpeaker, createTranscriber, hearingInstalled, voiceHome, voiceInstalled } from "../src/index";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-hearing-"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=6:r=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-pix_fmt", "yuv420p", "-shortest", join(dir, "tone.mp4")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=2:r=25", "-pix_fmt", "yuv420p", join(dir, "mute.mp4")]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("listening to a clip", () => {
  it("hands the listener the chosen part as sound, and remembers what it heard", async () => {
    const calls: number[] = [];
    const transcribe = createTranscriber({
      home: join(dir, "home-a"),
      download: false,
      installed: true,
      recognize: async (samples) => {
        calls.push(samples.length);
        return [{ start: 0.2, end: 1.4, text: " A sentence. " }, { start: 1.5, end: 1.55, text: "" }];
      },
    });
    const first = await transcribe(join(dir, "tone.mp4"), 1, 3);
    expect(first).toEqual([{ start: 0.2, end: 1.4, text: "A sentence." }]);
    // Three seconds at 16,000 samples a second.
    expect(calls).toEqual([48000]);
    expect(await transcribe(join(dir, "tone.mp4"), 1, 3)).toEqual(first);
    expect(calls).toHaveLength(1);
    await transcribe(join(dir, "tone.mp4"), 0, 2);
    expect(calls).toEqual([48000, 32000]);
  });

  it("hears nothing in a clip without sound, without asking the model", async () => {
    let asked = 0;
    const transcribe = createTranscriber({ home: join(dir, "home-b"), download: false, installed: true, recognize: async () => { asked += 1; return []; } });
    expect(await transcribe(join(dir, "mute.mp4"), 0, 2)).toEqual([]);
    expect(asked).toBe(0);
  });

  it("tells a file that is not there, or is not sound at all, from one in which nobody speaks", async () => {
    const transcribe = createTranscriber({ home: join(dir, "home-d"), download: false, installed: true, recognize: async () => [] });
    await expect(transcribe(join(dir, "missing.mp4"), 0, 2)).rejects.toThrow(/no file/i);
    await expect(transcribe(dir, 0, 2)).rejects.toThrow(/not a file/i);
    writeFileSync(join(dir, "notes.txt"), "just words");
    await expect(transcribe(join(dir, "notes.txt"), 0, 2)).rejects.toThrow(/not a video or sound file/i);
    expect(await transcribe(join(dir, "tone.mp4"), 0, 2)).toEqual([]);
  });

  it("drops what the model says of sounds that are not words, and refuses a language it does not know", async () => {
    const transcribe = createTranscriber({
      home: join(dir, "home-e"),
      download: false,
      installed: true,
      recognize: async () => [{ start: 0, end: 1, text: "(sad music)" }, { start: 1, end: 2, text: "*Dogs*" }, { start: 2, end: 3, text: "[BLANK_AUDIO]" }, { start: 3, end: 4, text: "Real words (mostly)." }],
    });
    expect(await transcribe(join(dir, "tone.mp4"), 0, 5)).toEqual([{ start: 3, end: 4, text: "Real words (mostly)." }]);
    await expect(transcribe(join(dir, "tone.mp4"), 0, 5, "zz")).rejects.toThrow(/not a language/);
  });

  it("keeps what it heard, and the sound it is working on, where only this user can read them", async () => {
    const home = join(dir, "home-f");
    const transcribe = createTranscriber({ home, download: false, installed: true, recognize: async () => [{ start: 0, end: 1, text: "Private words." }] });
    await transcribe(join(dir, "tone.mp4"), 0, 2);
    expect(statSync(join(home, "heard")).mode & 0o077).toBe(0);
    const note = readdirSync(join(home, "heard"))[0] ?? "";
    expect(statSync(join(home, "heard", note)).mode & 0o077).toBe(0);
    // Nothing is left of the sound that was listened to.
    expect(readdirSync(join(home, "tmp"))).toEqual([]);
  });

  it("says how to install the listening model when it may not download it", async () => {
    const transcribe = createTranscriber({ home: join(dir, "home-c"), download: false });
    await expect(transcribe(join(dir, "tone.mp4"), 0, 2)).rejects.toThrow("scenefile transcribe --install");
  });

  const ready = hearingInstalled(voiceHome()) && voiceInstalled(join(voiceHome(), "voices"), "en-emma");
  it.skipIf(!ready)("understands real speech", async () => {
    const line = await createSpeaker({ home: join(dir, "home-voice"), voicesDir: join(voiceHome(), "voices"), download: false })(
      "Scenefile turns a short script into a finished video.",
      "en-emma",
    );
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=8:r=25", "-i", line.file, "-af", "adelay=1000:all=1,apad", "-pix_fmt", "yuv420p", "-t", "8", join(dir, "spoken.mp4")]);
    const heard = await createTranscriber({ home: join(dir, "home-real"), modelHome: voiceHome(), download: false })(join(dir, "spoken.mp4"), 0, 8);
    const text = heard.map((part) => part.text).join(" ").toLowerCase();
    expect(text).toContain("script");
    expect(text).toContain("video");
    expect(heard[0]?.start).toBeGreaterThan(0.6);
    expect(heard[0]?.start).toBeLessThan(1.6);
    expect(heard.at(-1)?.end).toBeLessThan(6);
  });
});
