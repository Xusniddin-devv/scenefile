import { defineConfig } from "tsup";

// One self-contained script for the page: every dependency is inlined.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["iife"],
  platform: "browser",
  noExternal: [/.*/],
  minify: true,
  clean: true,
});
