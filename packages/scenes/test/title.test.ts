import { describe, expect, it } from "vitest";
import { escapeHtml, readingSeconds } from "../src/text";
import { titleDefinition } from "../src/title/definition";
import { titleSchema } from "../src/title/schema";
import { context } from "./context";

const ctx = context(0, 8);
const compile = (input: Record<string, unknown>, at = ctx): string =>
  titleDefinition.compile(titleSchema.parse({ type: "title", ...input }), at);

describe("text helpers", () => {
  it("counts reading time at three words per second", () => {
    expect(readingSeconds("one two three four five six")).toBe(2);
    expect(readingSeconds("   ")).toBe(0);
  });

  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`</script><b a="1">&'`)).toBe(
      "&lt;/script&gt;&lt;b a=&quot;1&quot;&gt;&amp;&#39;",
    );
  });
});

describe("title scene", () => {
  it("accepts a heading alone and defaults duration to auto", () => {
    const parsed = titleSchema.parse({ type: "title", heading: "Ship faster" });
    expect(parsed.duration).toBe("auto");
    expect(parsed.sub).toBeUndefined();
  });

  it("rejects an empty heading and unknown fields", () => {
    expect(titleSchema.safeParse({ type: "title", heading: "" }).success).toBe(false);
    expect(titleSchema.safeParse({ type: "title", heading: "x", color: "red" }).success).toBe(false);
  });

  it("lists its fields", () => {
    expect(titleDefinition.fields).toEqual(["type", "heading", "highlight", "sub", "duration", "transition"]);
  });

  it("requires highlight to be part of the heading", () => {
    const base = { type: "title", heading: "Video from JSON." };
    expect(titleSchema.safeParse({ ...base, highlight: "JSON." }).success).toBe(true);
    const bad = titleSchema.safeParse({ ...base, highlight: "json" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["highlight"]);
    expect(bad.error?.issues[0]?.message).toContain("heading");
  });

  it("compiles escaped text into fit slots that carry their scenefile path", () => {
    const html = compile({ heading: "A <b> tag", sub: "Tom & Jerry" });
    expect(html).toContain('data-sf-path="scenes[0].heading">A &lt;b&gt; tag</h1>');
    expect(html).toContain('data-sf-path="scenes[0].sub">Tom &amp; Jerry</p>');
    expect(html).toMatch(/<h1 [^>]*data-sf-enter="0"[^>]*data-sf-fit="[\d.,]+"[^>]*data-sf-lines="3"/);
    expect(html).toMatch(/<p [^>]*data-sf-enter="1"[^>]*data-sf-fit="[\d.,]+"/);
  });

  it("wraps the highlighted part, escaped, and nothing else", () => {
    const html = compile({ heading: "Fast & <safe> video", highlight: "<safe>" });
    expect(html).toContain("Fast &amp; <em>&lt;safe&gt;</em> video</h1>");
    expect(html.match(/<em>/g)).toHaveLength(1);
  });

  it("shows the scene's position in the video", () => {
    expect(compile({ heading: "x" }, context(2, 8))).toContain("<b>03</b> / 08");
  });

  it("omits the sub element when there is no sub", () => {
    expect(compile({ heading: "Solo" })).not.toContain("sf-title__sub");
  });

  it("holds for the reading time of heading and sub together", () => {
    const props = titleSchema.parse({ type: "title", heading: "one two three", sub: "four five six" });
    expect(titleDefinition.holdSeconds(props)).toBe(2);
    expect(titleDefinition.summary(props)).toBe("one two three");
  });

  it("declares its text for font checks", () => {
    const props = titleSchema.parse({ type: "title", heading: "A", sub: "B" });
    expect(titleDefinition.texts(props)).toEqual([
      { path: "heading", text: "A", font: "sans" },
      { path: "sub", text: "B", font: "sans" },
    ]);
    expect(titleDefinition.texts(titleSchema.parse({ type: "title", heading: "A" }))).toHaveLength(1);
  });
});
