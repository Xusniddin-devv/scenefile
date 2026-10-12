import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Downloads the Chromium build this version of scenefile was built against,
 * using the installer of the browser library scenefile itself depends on.
 * A separately installed copy of that library could fetch a different build,
 * which scenefile would then not find. Resolves with the installer's exit code.
 */
export function installBrowser(withDeps: boolean): Promise<number> {
  // The library exposes its package file but not its installer, so the installer is found beside it.
  const installer = join(dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")), "cli.js");
  const args = [installer, "install", ...(withDeps ? ["--with-deps"] : []), "chromium", "--only-shell"];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
