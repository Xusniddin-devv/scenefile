import { TOP_LEVEL_FIELDS } from "@scenefile/schema";
import { SCENE_TYPES, getScene } from "@scenefile/scenes";
import { describe, expect, it } from "vitest";
import { assetRefs } from "../src/assets";
import { check } from "../src/check";
import { TOP_LEVEL_DOCS, authoringGuide, formatDiagnostics, sceneGuide } from "../src/guide";

const filler = { type: "title", heading: "one two three four five six seven eight nine" };

/** Checks a scenefile as if every image it names had been loaded. */
function checkWithStubImages(scenes: unknown[]) {
  const input = { version: 1, scenes };
  const first = check(input);
  if (!first.scenefile) return first;
  const assets = new Map(
    assetRefs(first.scenefile).map((ref, i) => [
      ref.src,
      { id: `a${i}`, mime: "image/png" as const, width: 1280, height: 720, bytes: 1, dataUri: "data:image/png;base64,AAAA" },
    ]),
  );
  return check(input, { assets, diagnostics: [] });
}

describe.each(SCENE_TYPES)("documentation of the %s scene", (type) => {
  const { doc, fields } = getScene(type);

  it("says in one line what the scene is for", () => {
    expect(doc.purpose.length).toBeGreaterThan(15);
    expect(doc.purpose.length).toBeLessThanOrEqual(110);
    expect(doc.purpose).not.toContain("\n");
  });

  it("documents every field of its own, and no field it does not have", () => {
    const own = fields.filter((field) => !["type", "duration", "transition"].includes(field));
    expect(Object.keys(doc.fields).sort()).toEqual([...own].sort());
    for (const [field, text] of Object.entries(doc.fields)) expect(text.length, field).toBeGreaterThan(10);
  });

  it("gives an example that passes a full check without a single diagnostic", () => {
    expect(doc.example.type).toBe(type);
    const result = checkWithStubImages([doc.example, filler]);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("the authoring guide", () => {
  const guide = authoringGuide();

  it("fits in a small model's context: under 8,000 characters, about 2,000 tokens", () => {
    expect(guide.length).toBeLessThan(8000);
    expect(guide.length).toBeGreaterThan(3000);
  });

  it("names every scene type and every field of every scene", () => {
    for (const type of SCENE_TYPES) {
      expect(guide, type).toContain(`### ${type}`);
      for (const field of Object.keys(getScene(type).doc.fields)) expect(guide, `${type}.${field}`).toContain(`\`${field}\``);
    }
  });

  it("documents exactly the scenefile's own fields", () => {
    expect(Object.keys(TOP_LEVEL_DOCS).sort()).toEqual([...TOP_LEVEL_FIELDS].sort());
    for (const field of TOP_LEVEL_FIELDS) expect(guide, field).toContain(`\`${field}\``);
  });

  it("tells the reader how to work: write, check, fix, render, and what a problem looks like", () => {
    for (const word of ["check", "render", "fix", "path", "TEXT_OVERFLOW", "duration", "transition", "highlight"]) {
      expect(guide, word).toContain(word);
    }
  });

  it("contains a complete example scenefile that passes a full check", () => {
    const block = /```json\n([\s\S]*?)\n```/.exec(guide)?.[1] ?? "";
    const example = JSON.parse(block) as { scenes: unknown[] };
    const result = checkWithStubImages(example.scenes);
    expect(result.diagnostics).toEqual([]);
    expect(example.scenes.length).toBeGreaterThanOrEqual(3);
  });

  it("is the same text every time", () => {
    expect(authoringGuide()).toBe(guide);
  });
});

describe("sceneGuide", () => {
  it("shows one scene's fields and its example as JSON", () => {
    const text = sceneGuide("stat");
    expect(text).toContain("### stat");
    for (const field of ["value", "label", "note", "duration", "transition"]) expect(text).toContain(`\`${field}\``);
    const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)?.[1] ?? "null") as { type: string };
    expect(example.type).toBe("stat");
  });
});

describe("formatDiagnostics", () => {
  it("prints each problem with its path and fix, then a count", () => {
    const text = formatDiagnostics([
      { code: "TEXT_OVERFLOW", severity: "error", path: "scenes[0].heading", message: "Too long.", fix: "Shorten it." },
      { code: "AUTOFIXED", severity: "warning", path: "", message: "Read x as y.", fix: "Write y." },
    ]);
    expect(text.split("\n")).toEqual([
      "error  TEXT_OVERFLOW  scenes[0].heading",
      "  Too long.",
      "  fix: Shorten it.",
      "warning  AUTOFIXED",
      "  Read x as y.",
      "  fix: Write y.",
      "1 error, 1 warning",
    ]);
    expect(formatDiagnostics([])).toBe("No problems found.");
  });
});
