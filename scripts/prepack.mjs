// Run by `pnpm pack` and `pnpm publish` inside a package: every published
// package carries the licence, and the command line package the README too.
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
copyFileSync(resolve(root, "LICENSE"), "LICENSE");
if (JSON.parse(readFileSync("package.json", "utf8")).name === "scenefile") copyFileSync(resolve(root, "README.md"), "README.md");
