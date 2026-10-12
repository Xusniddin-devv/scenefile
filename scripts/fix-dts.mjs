// Run after `tsc` in a package: gives every relative import in the type
// declarations its file extension. The sources are written for a bundler, but
// a consumer using Node's own module resolution needs "./check.js", not "./check".
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".d.ts") ? [path] : [];
  });
}

for (const file of files("dist")) {
  const text = readFileSync(file, "utf8");
  const fixed = text.replace(/(\bfrom\s+|\bimport\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (whole, lead, quote, specifier) => {
    if (/\.(js|json)$/.test(specifier)) return whole;
    const target = join(dirname(file), specifier);
    const resolved = existsSync(`${target}.d.ts`) ? `${specifier}.js` : existsSync(join(target, "index.d.ts")) ? `${specifier}/index.js` : null;
    if (!resolved) throw new Error(`${file}: cannot find the declarations for "${specifier}"`);
    return `${lead}${quote}${resolved}${quote}`;
  });
  if (fixed !== text) writeFileSync(file, fixed);
}
