// Renders one scenefile with 1, 2 and 4 workers and prints how long each took.
// Usage: node scripts/bench.mjs [scenefile]   (after `pnpm build`)
import { readFileSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkWithAssets } from "../packages/engine/dist/index.js";
import { renderVideo } from "../packages/render/dist/index.js";

const file = resolve(process.argv[2] ?? "examples/launch.json");
const result = await checkWithAssets(JSON.parse(readFileSync(file, "utf8")), { baseDir: dirname(file) });
if (!result.composition) throw new Error(JSON.stringify(result.diagnostics, null, 2));
const { totalFrames, fps, width, height } = result.composition.manifest;
const seconds = totalFrames / fps;

console.log(`${file}`);
console.log(`${width}x${height}, ${fps} fps, ${seconds.toFixed(1)} s, ${totalFrames} frames, on ${cpus().length} cores (${cpus()[0]?.model ?? "unknown"})`);
console.log("workers  seconds  frames/s  x realtime");
for (const workers of [1, 2, 4]) {
  const output = join(tmpdir(), `scenefile-bench-${process.pid}-${workers}.mp4`);
  const report = await renderVideo(result.composition, { output, workers });
  const took = report.elapsedMs / 1000;
  console.log(`${String(report.workers).padStart(7)}  ${took.toFixed(1).padStart(7)}  ${(totalFrames / took).toFixed(0).padStart(8)}  ${(seconds / took).toFixed(2).padStart(10)}`);
  rmSync(output, { force: true });
}
