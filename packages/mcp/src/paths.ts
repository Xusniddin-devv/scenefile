import { realpath } from "node:fs/promises";
import { dirname, parse as parsePath, resolve as resolvePath } from "node:path";
import { isInside } from "@scenefile/engine";

export type Confined = { ok: true; path: string } | { ok: false; message: string };

/** The server's root as an absolute path. The filesystem root is refused: it would confine nothing. */
export function resolveRoot(root: string): string {
  const resolved = resolvePath(root);
  if (resolved === parsePath(resolved).root) {
    throw new Error("The server's root cannot be the filesystem root; start it in a project folder, or pass --root.");
  }
  return resolved;
}

function outside(given: string): Confined {
  return {
    ok: false,
    message: `"${given}" is outside the folder this server works in. Use a path inside it, written relative to it.`,
  };
}

/** An existing file named by the caller, confined to the root after links are followed. */
export async function existingInside(root: string, given: string): Promise<Confined> {
  const candidate = resolvePath(root, given);
  if (!isInside(root, candidate)) return outside(given);
  try {
    const [realRoot, real] = await Promise.all([realpath(root), realpath(candidate)]);
    return isInside(realRoot, real) ? { ok: true, path: real } : outside(given);
  } catch {
    return { ok: false, message: `There is no file "${given}" in the folder this server works in.` };
  }
}

/**
 * A file the caller wants written, which may not exist yet. Its nearest
 * existing folder is resolved through links and must be the root or inside it,
 * so a link cannot carry the write elsewhere.
 */
export async function writableInside(root: string, given: string): Promise<Confined> {
  const candidate = resolvePath(root, given);
  if (!isInside(root, candidate)) return outside(given);
  const realRoot = await realpath(root);
  let folder = dirname(candidate);
  for (;;) {
    try {
      const real = await realpath(folder);
      return real === realRoot || isInside(realRoot, real) ? { ok: true, path: candidate } : outside(given);
    } catch {
      const parent = dirname(folder);
      if (parent === folder) return outside(given);
      folder = parent;
    }
  }
}
