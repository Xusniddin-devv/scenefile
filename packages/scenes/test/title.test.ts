import { describe, expect, it } from "vitest";
import { escapeHtml, readingSeconds } from "../src/text";
import { titleDefinition } from "../src/title/definition";
import { titleSchema } from "../src/title/schema";

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
    expect(titleDefinition.fields).toEqual(["type", "heading", "sub", "duration"]);
  });

  it("compiles escaped HTML with enter order on each element", () => {
    const html = titleDefinition.compile(
      titleSchema.parse({ type: "title", heading: "A <b> tag", sub: "Tom & Jerry" }),
    );
    expect(html).toContain('<h1 class="sf-title__heading" data-sf-enter="0">A &lt;b&gt; tag</h1>');
    expect(html).toContain('<p class="sf-title__sub" data-sf-enter="1">Tom &amp; Jerry</p>');
  });

  it("omits the sub element when there is no sub", () => {
    const html = titleDefinition.compile(titleSchema.parse({ type: "title", heading: "Solo" }));
    expect(html).not.toContain("sf-title__sub");
  });

  it("holds for the reading time of heading and sub together", () => {
    const props = titleSchema.parse({ type: "title", heading: "one two three", sub: "four five six" });
    expect(titleDefinition.holdSeconds(props)).toBe(2);
    expect(titleDefinition.summary(props)).toBe("one two three");
  });
});
