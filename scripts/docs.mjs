// Writes the files that are generated from the code. Run with `pnpm generate` after changing a scene.
import { mkdirSync, writeFileSync } from "node:fs";
import { skillFile } from "../packages/engine/dist/index.js";

mkdirSync("skills/scenefile", { recursive: true });
writeFileSync("skills/scenefile/SKILL.md", skillFile());
console.log("wrote skills/scenefile/SKILL.md");
