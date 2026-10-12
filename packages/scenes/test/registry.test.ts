import { describe, expect, it } from "vitest";
import { SCENE_TYPES, getScene, isSceneType, sceneSchema } from "../src/index";

describe("scene registry", () => {
  it("knows every scene type in the schema", () => {
    expect(SCENE_TYPES.slice(0, 1)).toEqual(["title"]);
    expect(SCENE_TYPES.at(-1)).toBe("terminal");
    expect(new Set(SCENE_TYPES).size).toBe(SCENE_TYPES.length);
    for (const type of SCENE_TYPES) expect(getScene(type).type).toBe(type);
  });

  it("narrows strings to scene types", () => {
    expect(isSceneType("title")).toBe(true);
    expect(isSceneType("toString")).toBe(false);
    expect(isSceneType("video")).toBe(false);
  });

  it("parses a scene by its type", () => {
    const scene = sceneSchema.parse({ type: "terminal", steps: [{ run: "ls" }] });
    expect(scene.type).toBe("terminal");
  });
});
