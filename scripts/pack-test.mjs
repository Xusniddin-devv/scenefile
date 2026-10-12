// Packs every package as it would be published, installs the tarballs into an
// empty folder with npm, and makes a video with the installed command. This is
// what proves the published files are complete: fonts, the browser bundle, the lot.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "scenefile-pack-"));
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...options });
try {
  const tarballs = join(work, "tarballs");
  for (const name of readdirSync(join(root, "packages"))) {
    run("pnpm", ["pack", "--pack-destination", tarballs], { cwd: join(root, "packages", name) });
  }
  const files = readdirSync(tarballs).map((file) => join(tarballs, file));
  console.log(files.map((file) => `${(statSync(file).size / 1024).toFixed(0).padStart(6)} kB  ${file.split("/").pop()}`).join("\n"));

  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "pack-test", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", ...files], { cwd: app });
  const bin = join(app, "node_modules", ".bin", "scenefile");
  // The browser is shared with the repository's own install; a new user runs the command the README gives.
  run(bin, ["init", "."], { cwd: app });
  console.log(run(bin, ["check", "scenefile.json"], { cwd: app }).trim().split("\n").slice(-1)[0]);
  console.log(run(bin, ["render", "scenefile.json", "-o", "video.mp4", "--quality", "draft"], { cwd: app }).trim().split("\n").slice(-1)[0]);
  if (statSync(join(app, "video.mp4")).size < 10_000) throw new Error("the rendered video is suspiciously small");
  if (run(bin, ["guide"], { cwd: app }).length < 5000) throw new Error("the guide is too short to be the guide");
  // A consumer using Node's own module resolution gets real types, not `any`.
  writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "nodenext", strict: true, noEmit: true, types: ["node"], typeRoots: [join(root, "node_modules", "@types")] }, files: ["consumer.ts"] }));
  writeFileSync(
    join(app, "consumer.ts"),
    [
      'import { check } from "@scenefile/engine";',
      'import { renderVideo } from "@scenefile/render";',
      'import { createServer } from "@scenefile/mcp";',
      "const result = check({});",
      "const ok: boolean = result.ok;",
      "// @ts-expect-error a check result is not a number; this line fails if the types have decayed to `any`",
      "const wrong: number = result;",
      "void [ok, wrong, renderVideo, createServer];",
      "",
    ].join("\n"),
  );
  run(join(root, "node_modules", ".bin", "tsc"), ["-p", app], { stdio: ["ignore", "inherit", "inherit"] });
  console.log("types ok");
  console.log("pack test passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
