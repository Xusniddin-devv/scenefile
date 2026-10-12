import { describe, expect, it } from "vitest";
import { terminalDefinition } from "../src/terminal/definition";
import { terminalSchema } from "../src/terminal/schema";
import { terminalSchedule, typedLength } from "../src/terminal/timing";

describe("terminal timing", () => {
  it("types 20 characters per second, then pauses, then shows output", () => {
    const [first, second] = terminalSchedule([
      { run: "0123456789", output: "one two three" },
      { run: "ab" },
    ]);
    expect(first).toEqual({ typeStart: 0, typeEnd: 0.5, outputAt: 0.8, end: 0.8 + 0.6 + 1 });
    expect(second?.typeStart).toBeCloseTo(2.4);
    expect(second?.end).toBeCloseTo(2.4 + 0.1 + 0.3);
  });

  it("counts characters by code point, not UTF-16 unit", () => {
    const [timing] = terminalSchedule([{ run: "🚀🚀" }]);
    expect(timing?.typeEnd).toBeCloseTo(0.1);
  });

  it("clamps the typed length to the command", () => {
    const [timing] = terminalSchedule([{ run: "abcd" }]);
    if (!timing) throw new Error("no timing");
    expect(typedLength(4, timing, -1)).toBe(0);
    expect(typedLength(4, timing, 0.1)).toBe(2);
    expect(typedLength(4, timing, 99)).toBe(4);
  });
});

describe("terminal scene", () => {
  it("requires at least one step and rejects unknown step fields", () => {
    expect(terminalSchema.safeParse({ type: "terminal", steps: [] }).success).toBe(false);
    expect(
      terminalSchema.safeParse({ type: "terminal", steps: [{ run: "ls", cwd: "/" }] }).success,
    ).toBe(false);
  });

  it("compiles each step with its command in a data attribute, escaped", () => {
    const props = terminalSchema.parse({
      type: "terminal",
      steps: [{ run: 'echo "<hi>"', output: "<hi>" }, { run: "ls" }],
    });
    const html = terminalDefinition.compile(props);
    expect(html).toContain('data-sf-type="echo &quot;&lt;hi&gt;&quot;"');
    expect(html).toContain('<pre class="sf-terminal__out" data-sf-out>&lt;hi&gt;</pre>');
    expect(html.match(/sf-terminal__step/g)).toHaveLength(2);
    expect(html.match(/data-sf-out/g)).toHaveLength(1);
  });

  it("holds until the last step ends, plus a tail", () => {
    const props = terminalSchema.parse({ type: "terminal", steps: [{ run: "0123456789" }] });
    expect(terminalDefinition.holdSeconds(props)).toBeCloseTo(0.5 + 0.3 + 0.4);
    expect(terminalDefinition.summary(props)).toBe("$ 0123456789");
  });

  it("summarizes extra steps as a count", () => {
    const props = terminalSchema.parse({ type: "terminal", steps: [{ run: "a" }, { run: "b" }, { run: "c" }] });
    expect(terminalDefinition.summary(props)).toBe("$ a (+2 more)");
  });
});
