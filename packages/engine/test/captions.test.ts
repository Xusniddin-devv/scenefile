import { describe, expect, it } from "vitest";
import { captionCues, check } from "../src/index";

const line = "Run pgsnap save before a risky change. If something breaks, pgsnap restore puts everything back the way it was.";

describe("splitting a spoken line into captions", () => {
  it("shows a few words at a time, in order, with nothing lost", () => {
    const cues = captionCues(line, 100, 6, 30, 48);
    expect(cues.map((cue) => cue.text).join(" ")).toBe(line);
    for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(48);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    // A pause in the sentence is a better place to break than the middle of a phrase.
    expect(cues[0]?.text).toBe("Run pgsnap save before a risky change.");
  });

  it("covers the whole line without gaps or overlaps, in step with the voice", () => {
    const cues = captionCues(line, 100, 6, 30, 48);
    expect(cues[0]?.from).toBe(100);
    for (let i = 1; i < cues.length; i++) expect(cues[i]?.from).toBe(cues[i - 1]?.to);
    expect(cues.at(-1)?.to).toBeGreaterThanOrEqual(100 + 6 * 30);
    // Longer captions stay up longer.
    const [first, second] = cues;
    const rate = (cue: typeof first) => ((cue?.to ?? 0) - (cue?.from ?? 0)) / (cue?.text.length ?? 1);
    expect(rate(first)).toBeCloseTo(rate(second), 0);
  });

  it("keeps a word longer than a caption whole", () => {
    expect(captionCues("Supercalifragilisticexpialidocious indeed", 0, 2, 30, 12).map((cue) => cue.text)).toEqual([
      "Supercalifragilisticexpialidocious",
      "indeed",
    ]);
  });
});

describe("captions in the video", () => {
  const speech = new Map([[0, { file: "/cache/0.wav", seconds: 6 }]]);
  const narrated = (captions: boolean, say = line) => ({
    version: 1,
    voice: { name: "en-kristin", captions },
    scenes: [{ type: "title", heading: "Safe changes", say }, { type: "outro", heading: "Try it." }],
  });
  const loaded = { assets: new Map(), diagnostics: [], speech };

  it("puts each caption in the page with the frames it is shown for, and makes room below the scenes", () => {
    const html = check(narrated(true), loaded).composition?.html ?? "";
    expect(html).toContain('class="sf-captions"');
    expect(html).toMatch(/<p data-sf-cue="15,\d+" hidden>Run pgsnap save before a risky change\.<\/p>/);
    expect(html).toContain('id="sf-stage" class="sf-captioned"');
    const plain = check(narrated(false), loaded).composition?.html ?? "";
    expect(plain).not.toContain("data-sf-cue");
    expect(plain).not.toContain('class="sf-captioned"');
  });

  it("never lets caption text become markup", () => {
    const html = check(narrated(true, "Type <b>bold</b> & press enter."), loaded).composition?.html ?? "";
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("checks that captions can be drawn, since they are text on screen", () => {
    const odd = "Done 한 and ready to go today.";
    expect(check(narrated(true, odd), loaded).diagnostics).toContainEqual(
      expect.objectContaining({ code: "GLYPH_MISSING", path: "scenes[0].say" }),
    );
    expect(check(narrated(false, odd), loaded).diagnostics.filter((d) => d.code === "GLYPH_MISSING")).toEqual([]);
  });
});

describe("captions that read well", () => {
  const texts = (line: string, most = 48) => captionCues(line, 0, line.length / 16, 30, most).map((cue) => cue.text);

  it("never leaves a word or two stranded on its own", () => {
    expect(texts("If something breaks, pgsnap restore puts everything back.")).toEqual([
      "If something breaks,",
      "pgsnap restore puts everything back.",
    ]);
    for (const line of [
      "Restoring a two gigabyte database takes four seconds, against ninety four with a plain dump, which is much slower.",
      "It saves your whole Postgres database with one command, and brings it back with another.",
    ]) {
      for (const text of texts(line)) expect(text.split(" ").length, text).toBeGreaterThan(1);
    }
  });

  it("keeps very short sentences with their neighbours, and does not stop at an abbreviation", () => {
    expect(texts("Yes. It works. Try it today.")).toEqual(["Yes. It works. Try it today."]);
    expect(texts("Use e.g. a cron job to run it nightly.")).toEqual(["Use e.g. a cron job to run it nightly."]);
    expect(texts("Version 2.0 is out. Dr. Lee tested it all.")).toEqual(["Version 2.0 is out. Dr. Lee tested it all."]);
  });

  it("allows for figures taking longer to say than to write", () => {
    const line = "In 2024 it handled 1,250,000 requests at 99.99% uptime. Nobody noticed a thing.";
    const cues = captionCues(line, 0, 10, 30);
    const last = cues.at(-1);
    expect(last?.text).toBe("Nobody noticed a thing.");
    // By letters alone the last sentence would start 71% of the way in; the figures before it take far longer to say.
    expect(last?.from).toBeGreaterThan(0.8 * 300);
  });

  it("works the same at 60 frames a second, ending just after the voice", () => {
    const cues = captionCues("One two three four five six seven eight nine ten eleven twelve thirteen.", 30, 4, 60);
    for (let i = 1; i < cues.length; i++) expect(cues[i]?.from).toBe(cues[i - 1]?.to);
    expect(cues.at(-1)?.to).toBeGreaterThanOrEqual(30 + 240);
    expect(cues.at(-1)?.to).toBeLessThanOrEqual(30 + 240 + 15);
  });
});
