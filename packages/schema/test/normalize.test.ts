import { describe, expect, it } from "vitest";
import { normalize } from "../src/normalize";

const minimal = { version: 1, scenes: [{ type: "title", heading: "Hi" }] };

describe("normalize", () => {
  it("fills defaults on a minimal scenefile", () => {
    const { scenefile, diagnostics } = normalize(minimal);
    expect(diagnostics).toEqual([]);
    expect(scenefile).toMatchObject({
      version: 1,
      format: "landscape-1080p",
      fps: 30,
      theme: "signal",
      scenes: [{ type: "title", heading: "Hi", duration: "auto" }],
    });
  });

  it("does not mutate its input", () => {
    const input = { version: 1, scenes: [{ type: "Title", heading: "Hi", subtitle: "x" }] };
    const copy = structuredClone(input);
    normalize(input);
    expect(input).toEqual(copy);
  });

  it.each([null, 42, "text", []])("rejects a non-object root: %j", (input) => {
    const { scenefile, diagnostics } = normalize(input);
    expect(scenefile).toBeNull();
    expect(diagnostics).toEqual([expect.objectContaining({ code: "SCHEMA_ROOT", path: "" })]);
  });

  it("renames known aliases with a warning", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "title", title: "Hi", subtitle: "there" }],
    });
    expect(scenefile?.scenes[0]).toMatchObject({ heading: "Hi", sub: "there" });
    expect(diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ["AUTOFIXED", "warning", "scenes[0].title"],
      ["AUTOFIXED", "warning", "scenes[0].subtitle"],
    ]);
  });

  it("fixes the case of a scene type and of field names", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: " Title ", Heading: "Hi" }],
    });
    expect(scenefile?.scenes[0]).toMatchObject({ type: "title", heading: "Hi" });
    expect(diagnostics.every((d) => d.code === "AUTOFIXED")).toBe(true);
    expect(diagnostics).toHaveLength(2);
  });

  it("coerces duration strings", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [
        { type: "title", heading: "a", duration: "5s" },
        { type: "title", heading: "b", duration: " 2.5 seconds" },
        { type: "title", heading: "c", duration: "AUTO" },
      ],
    });
    expect(scenefile?.scenes.map((s) => s.duration)).toEqual([5, 2.5, "auto"]);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[0]).toMatchObject({ code: "AUTOFIXED", path: "scenes[0].duration" });
  });

  it("suggests the nearest field for a typo and reports it once", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "title", heading: "Hi", duraton: 3 }],
    });
    expect(scenefile).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "SCHEMA_UNKNOWN_FIELD",
      severity: "error",
      path: "scenes[0].duraton",
    });
    expect(diagnostics[0]?.message).toContain('Did you mean "duration"?');
    expect(diagnostics[0]?.fix).toContain("heading");
  });

  it("suggests the nearest scene type and reports the scene once", () => {
    const { diagnostics } = normalize({ version: 1, scenes: [{ type: "terminl", steps: [] }] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_UNKNOWN_SCENE", path: "scenes[0].type" });
    expect(diagnostics[0]?.message).toContain('Did you mean "terminal"?');
  });

  it("reports a scene with no type", () => {
    const { diagnostics } = normalize({ version: 1, scenes: [{ heading: "Hi" }] });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "SCHEMA_UNKNOWN_SCENE", path: "scenes[0].type" }),
    ]);
    expect(diagnostics[0]?.fix).toContain("title, terminal");
  });

  it("reports unknown top-level fields with a suggestion", () => {
    const { diagnostics } = normalize({ ...minimal, themee: "midnight" });
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_UNKNOWN_FIELD", path: "themee" });
    expect(diagnostics[0]?.message).toContain('"theme"');
  });

  it("reports schema violations with a bracketed path", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "terminal", steps: [{ run: "ls", cwd: "/" }] }],
    });
    expect(scenefile).toBeNull();
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", severity: "error" });
    expect(diagnostics[0]?.path.startsWith("scenes[0].steps[0]")).toBe(true);
  });

  it("reports a missing scenes array and an empty one", () => {
    expect(normalize({ version: 1 }).diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "scenes" });
    expect(normalize({ version: 1, scenes: [] }).diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "scenes" });
  });

  it("rejects an unsupported version and a malformed accent", () => {
    expect(normalize({ ...minimal, version: 2 }).diagnostics[0]).toMatchObject({ path: "version" });
    expect(normalize({ ...minimal, accent: "red" }).diagnostics[0]).toMatchObject({ path: "accent" });
    expect(normalize({ ...minimal, accent: "#FF5722" }).scenefile?.accent).toBe("#FF5722");
  });

  it("writes each fix from the violation itself, never pointing at a command", () => {
    const title = { type: "title", heading: "x" };
    const fps = normalize({ version: 1, fps: 24, scenes: [title] }).diagnostics;
    const nested = normalize({ version: 1, scenes: [{ type: "terminal", steps: [{ run: "ls", cwd: "/" }] }] }).diagnostics;
    const missing = normalize({ version: 1, scenes: [{ type: "title" }] }).diagnostics;
    const duration = normalize({ version: 1, scenes: [{ ...title, duration: true }] }).diagnostics;
    const tooLong = normalize({ version: 1, scenes: [{ type: "title", heading: "x".repeat(81) }] }).diagnostics;

    expect(fps[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "fps" });
    expect(fps[0]?.fix).toContain("30, 60");
    expect(nested[0]?.fix).toContain("cwd");
    expect(missing[0]).toMatchObject({ path: "scenes[0].heading" });
    expect(missing[0]?.fix).toMatch(/required/i);
    expect(`${duration[0]?.message} ${duration[0]?.fix}`).toContain('"auto"');
    expect(tooLong[0]?.fix).toContain("80");
    for (const d of [...fps, ...nested, ...missing, ...duration, ...tooLong]) {
      expect(d.fix).not.toContain("scenefile scenes");
      expect(d.fix.length).toBeGreaterThan(10);
    }
  });

  it("strips terminal color codes and other control characters, and says so", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [
        { type: "terminal", steps: [{ run: "npm test", output: "\u001b[32mok\u001b[0m done\n\ttwo\u0007" }] },
        { type: "title", heading: "Plain\u0000 text" },
      ],
    });
    const scene = scenefile?.scenes[0];
    expect(scene?.type === "terminal" && scene.steps[0]?.output).toBe("ok done\n\ttwo");
    expect(scenefile?.scenes[1]).toMatchObject({ heading: "Plain text" });
    expect(diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ["AUTOFIXED", "warning", "scenes[0].steps[0].output"],
      ["AUTOFIXED", "warning", "scenes[1].heading"],
    ]);
    expect(diagnostics[0]?.message).toMatch(/color codes/);
  });

  it("keeps reporting other scenes when one is broken", () => {
    const { diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "nope" }, { type: "title", heading: "" }],
    });
    expect(diagnostics.map((d) => d.path)).toEqual(["scenes[0].type", "scenes[1].heading"]);
  });
});
