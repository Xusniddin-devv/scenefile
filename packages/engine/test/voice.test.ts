import { describe, expect, it } from "vitest";
import { SCENE_TYPES, getScene } from "@scenefile/scenes";
import { normalize } from "@scenefile/schema";
import { authoringGuide, check, checkWithAssets, estimateSpeechSeconds, resolve } from "../src/index";

const narrated = {
  version: 1,
  scenes: [
    { type: "title", heading: "Ship faster", say: "This tool deploys your site with a single command." },
    { type: "stat", value: "60x", label: "faster releases", say: "Releases are sixty times faster." },
    { type: "outro", heading: "Try it today." },
  ],
};
const parsed = (input: unknown) => {
  const { scenefile, diagnostics } = normalize(input);
  if (!scenefile) throw new Error(JSON.stringify(diagnostics));
  return scenefile;
};
const speech = (seconds: number[]) => new Map(seconds.map((s, index) => [index, { file: `/cache/${index}.wav`, seconds: s }]));

describe("narration in the scenefile", () => {
  it("lets every scene type carry words to be spoken", () => {
    for (const type of SCENE_TYPES) {
      const example = { ...(getScene(type).doc.example as object), say: "A sentence for the narrator." };
      const { diagnostics } = normalize({ version: 1, scenes: [example, example] });
      expect(diagnostics.filter((d) => d.severity === "error"), type).toEqual([]);
      expect(getScene(type).fields, type).toContain("say");
    }
  });

  it("names the voice, and refuses one that does not exist", () => {
    expect(parsed({ ...narrated, voice: { name: "en-kristin" } }).voice).toEqual({ name: "en-kristin" });
    const { diagnostics } = normalize({ ...narrated, voice: { name: "morgan" } });
    expect(diagnostics[0]).toMatchObject({ severity: "error", path: "voice.name" });
    expect(diagnostics[0]?.fix).toContain("en-joe");
  });
});

describe("timing a scene to what is said in it", () => {
  it("keeps a scene on screen until its narration has finished", () => {
    const { video } = resolve(parsed(narrated), new Map(), speech([6, 2]));
    const [title] = video.scenes;
    expect(title?.speech).toEqual({ startFrame: 15, seconds: 6, file: "/cache/0.wav" });
    // Half a second before the voice, the speech, a breath after it, then the exit.
    expect(title?.durationFrames).toBeGreaterThanOrEqual(15 + 180 + 10);
  });

  it("never lets two scenes speak at once, even when they overlap on screen", () => {
    const { video } = resolve(parsed({ ...narrated, transition: "push" }), new Map(), speech([6, 2]));
    const [first, second] = video.scenes;
    const firstEnds = (first?.speech?.startFrame ?? 0) + 6 * 30;
    expect(second?.overlapFrames).toBeGreaterThan(0);
    expect(second?.speech?.startFrame).toBeGreaterThan(firstEnds);
  });

  it("estimates the length from the text until the voice has been made", () => {
    expect(estimateSpeechSeconds("a".repeat(130))).toBeCloseTo(10.5, 0);
    const { video } = resolve(parsed(narrated));
    expect(video.scenes[0]?.speech?.file).toBeUndefined();
    expect(video.scenes[0]?.speech?.seconds).toBeCloseTo(estimateSpeechSeconds(narrated.scenes[0]?.say ?? ""), 5);
    expect(video.scenes[2]?.speech).toBeUndefined();
  });

  it("lengthens a scene whose given duration is shorter than its narration, and says so", () => {
    const short = { ...narrated, scenes: [{ ...narrated.scenes[0], duration: 2 }, narrated.scenes[2]] };
    const { video, diagnostics } = resolve(parsed(short), new Map(), speech([6]));
    expect(video.scenes[0]?.durationFrames).toBeGreaterThan(6 * 30);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "PACING_FAST", severity: "warning", path: "scenes[0].duration" })]);
    expect(diagnostics[0]?.message).toMatch(/narration/);
  });
});

describe("checking a narrated scenefile", () => {
  it("hands the renderer each clip and when it starts", () => {
    const result = check(narrated, { assets: new Map(), diagnostics: [], speech: speech([6, 2]) });
    expect(result.ok).toBe(true);
    const clips = result.composition?.narration ?? [];
    expect(clips.map((clip) => clip.file)).toEqual(["/cache/0.wav", "/cache/1.wav"]);
    expect(clips[0]?.atSeconds).toBeCloseTo(0.5, 5);
    expect(clips[1]?.atSeconds).toBeGreaterThan(6.5);
    expect(result.storyboard.split("\n")[0]).toContain("voice");
    expect(result.storyboard).toMatch(/say\s+6\.0s of speech from 0\.50s/);
  });

  it("describes estimated speech as estimated, and gives the renderer nothing to play", () => {
    const result = check(narrated);
    expect(result.ok).toBe(true);
    expect(result.composition?.narration).toBeUndefined();
    expect(result.storyboard).toMatch(/say\s+about \d+\.\ds of speech/);
  });

  it("asks for each line in the scenefile's voice, and reports a line that could not be spoken", async () => {
    const asked: [string, string][] = [];
    const result = await checkWithAssets(
      { ...narrated, voice: { name: "ru-denis" } },
      {
        baseDir: "/nowhere",
        speak: async (text, voice) => {
          asked.push([text, voice]);
          if (text.startsWith("Releases")) throw new Error("The voice service refused the request (402).");
          return { file: "/cache/a.wav", seconds: 3 };
        },
      },
    );
    expect(asked).toEqual([
      ["This tool deploys your site with a single command.", "ru-denis"],
      ["Releases are sixty times faster.", "ru-denis"],
    ]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "VOICE_FAILED", severity: "error", path: "scenes[1].say" }),
    ]);
    expect(result.diagnostics[0]?.message).toContain("402");
  });
});

describe("the guide", () => {
  it("teaches narration", () => {
    const guide = authoringGuide();
    expect(guide).toContain("`say`");
    expect(guide).toContain("voice");
    expect(guide.length).toBeLessThan(8000);
  });
});
