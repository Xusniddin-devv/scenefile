import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/index";

const root = join(import.meta.dirname, "..", "..", "..", "skills");
const recipes = readdirSync(root).filter((name) => name !== "scenefile");

describe("recipe skills", () => {
  it("covers the videos people ask for", () => {
    expect(recipes.sort()).toEqual([
      "scenefile-app-walkthrough",
      "scenefile-changelog-video",
      "scenefile-edit-video",
      "scenefile-explain-code",
      "scenefile-launch-video",
      "scenefile-repo-tour",
    ]);
  });

  it.each(recipes)("%s: says when to use it, holds to the facts rule, and its example passes the check", (name) => {
    const skill = readFileSync(join(root, name, "SKILL.md"), "utf8");
    const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
    expect(front?.[1]).toBe(name);
    expect(front?.[2]).toMatch(/^Use when /);
    expect(front?.[2]?.length).toBeLessThan(400);
    expect(skill).toContain("Do not invent");
    expect(skill).toContain("scenefile check");
    // Short enough to read in one go beside the guide.
    expect(skill.length).toBeLessThan(6200);

    const example = JSON.parse(readFileSync(join(root, name, "example.json"), "utf8")) as { scenes: { type: string; src?: string; say?: string }[] };
    // Pictures are stood in for; everything else is checked for real.
    const assets = new Map(
      example.scenes.flatMap((scene) =>
        scene.src ? [[scene.src, { id: scene.src, src: scene.src, width: scene.src.includes("phone") ? 1170 : 2560, height: scene.src.includes("phone") ? 2532 : 1600, mime: "image/png", bytes: 10, dataUri: "data:image/png;base64,AA==" }] as const] : [],
      ),
    );
    // So are video files: thirty seconds each, with sound.
    const clips = new Map(
      example.scenes.flatMap((scene) => (scene.type === "clip" && scene.src ? [[scene.src, { file: `/videos/${scene.src}`, width: 1920, height: 1080, seconds: 30, audio: true }] as const] : [])),
    );
    const pictures = new Map([...assets].filter(([src]) => !clips.has(src)));
    // And what is said in a captioned clip is taken to have been heard.
    const transcripts = new Map(example.scenes.flatMap((scene, index) => ((scene as { captions?: boolean }).captions ? [[index, [{ start: 0.5, end: 3, text: "Welcome to the release." }]] as const] : [])));
    const result = check(example, { assets: pictures as never, clips, transcripts: transcripts as never, diagnostics: [] });
    expect(result.diagnostics).toEqual([]);
    // Every scene has words: a narrator's, or the clip's own.
    expect(example.scenes.every((scene) => typeof scene.say === "string" || (scene as { captions?: boolean }).captions === true)).toBe(true);
    expect(example.scenes.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the plugin", () => {
  const top = join(root, "..");
  const read = (path: string) => JSON.parse(readFileSync(join(top, path), "utf8"));

  it("runs the same version of scenefile that its skills describe", () => {
    const plugin = read(".claude-plugin/plugin.json");
    const published = read("packages/cli/package.json").version as string;
    expect(plugin.version).toBe(published);
    expect(plugin.mcpServers.scenefile.args).toEqual(["-y", `scenefile@${published}`, "mcp"]);
    // Kept inside the plugin, so merely opening this repository offers nobody a server.
    expect(() => readFileSync(join(top, ".mcp.json"))).toThrow();
  });
});
