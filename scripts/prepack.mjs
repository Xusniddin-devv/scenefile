// Run by `pnpm pack` and `pnpm publish` inside a package: every published
// package carries the licence, and the command line package the README too.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
copyFileSync(resolve(root, "LICENSE"), "LICENSE");
const { name, description } = JSON.parse(readFileSync("package.json", "utf8"));
const home = "https://github.com/Xusniddin-devv/scenefile";
if (name === "scenefile") {
  // Pictures in the README are files in the repository; on npm they need full addresses.
  const readme = readFileSync(resolve(root, "README.md"), "utf8").replace(/\]\((docs|examples)\//g, `](${home}/blob/main/$1/`);
  writeFileSync("README.md", readme.replace(/blob\/main\/(docs\/media\/[^)]+)/g, "raw/main/$1"));
} else {
  writeFileSync("README.md", `# ${name}\n\n${description}\n\nA part of [scenefile](${home}), which turns a JSON scenefile into a video. Most people want the \`scenefile\` package; this one is for building on its internals, and its interface may change between minor versions until 1.0.\n`);
}
