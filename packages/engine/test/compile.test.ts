import { normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import { resolve } from "../src/resolve";

function compiled(input: unknown) {
  const { scenefile } = normalize(input);
  if (!scenefile) throw new Error("invalid fixture");
  return compile(resolve(scenefile).video);
}

const input = {
  version: 1,
  accent: "#00FF88",
  scenes: [
    { type: "title", heading: "</script><script>alert(1)</script>" },
    { type: "terminal", steps: [{ run: "ls" }] },
  ],
};

describe("compile", () => {
  it("emits one section per scene, in order", () => {
    const { html } = compiled(input);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    const first = html.indexOf('data-sf-scene="0" data-sf-type="title"');
    const second = html.indexOf('data-sf-scene="1" data-sf-type="terminal"');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("embeds a manifest that matches the returned one", () => {
    const { html, manifest } = compiled(input);
    const match = /<script id="sf-manifest" type="application\/json">(.*?)<\/script>/s.exec(html);
    expect(JSON.parse(match?.[1] ?? "null")).toEqual(manifest);
    expect(manifest.scenes).toHaveLength(2);
    expect(manifest.totalFrames).toBe(
      manifest.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0),
    );
    expect(manifest.scenes[0]).toEqual({
      index: 0, type: "title", startFrame: 0, durationFrames: 75, enterFrames: 18, exitFrames: 12,
    });
  });

  it("keeps user text from closing the document's own tags", () => {
    const { html } = compiled(input);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("applies the accent override and sizes the page to the format", () => {
    const { html } = compiled(input);
    expect(html).toContain("--sf-accent:#00FF88");
    expect(html).toContain("--sf-unit:10.8px");
    expect(html).toContain("width:1920px;height:1080px");
  });

  it("includes CSS only for the scene types used", () => {
    const titleOnly = compiled({ version: 1, scenes: [{ type: "title", heading: "Hi" }] });
    expect(titleOnly.html).toContain(".sf-title__heading");
    expect(titleOnly.html).not.toContain(".sf-terminal__body");
  });
});
