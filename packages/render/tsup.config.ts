import { defineConfig } from "tsup";

export default defineConfig({ entry: ["src/index.ts", "src/voice-worker.ts"], format: ["esm"], clean: true });
