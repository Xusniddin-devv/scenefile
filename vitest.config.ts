import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string, file = "index.ts"): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@scenefile/scenes/browser", replacement: src("scenes", "browser.ts") },
      { find: "@scenefile/scenes", replacement: src("scenes") },
      { find: "@scenefile/schema", replacement: src("schema") },
      { find: "@scenefile/engine", replacement: src("engine") },
      { find: "@scenefile/render", replacement: src("render") },
      { find: "@scenefile/mcp", replacement: src("mcp") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 60_000,
  },
});
