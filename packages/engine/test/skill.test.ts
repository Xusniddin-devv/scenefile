import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { skillFile } from "../src/guide";

describe("skills/scenefile/SKILL.md", () => {
  it("is exactly what the code generates; run `pnpm generate` after changing a scene", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../skills/scenefile/SKILL.md", import.meta.url)), "utf8");
    expect(committed).toBe(skillFile());
  });

  it("starts with the front matter agents use to decide when to load it", () => {
    const text = skillFile();
    expect(text.startsWith("---\nname: scenefile\ndescription: ")).toBe(true);
    expect(text).toContain("scenefile check");
    expect(text).toContain("scenefile render");
    expect(text).toContain("# Making a video with scenefile");
  });
});
