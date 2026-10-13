import { statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join, parse as parsePath, resolve as resolvePath } from "node:path";
import { isInside } from "@scenefile/engine";

export type Confined = { ok: true; path: string } | { ok: false; message: string };

/** Largest scenefile read from a path. A real one is a few kilobytes. */
const MAX_SCENEFILE_BYTES = 5 * 1024 * 1024;

/**
 * The server's root as an absolute path. It must be an existing folder, and
 * not the filesystem root, which would confine nothing.
 */
export function resolveRoot(root: string): string {
  const resolved = resolvePath(root);
  if (resolved === parsePath(resolved).root) {
    throw new Error("The server's root cannot be the filesystem root; start it in a project folder, or pass --root.");
  }
  let isFolder = false;
  try {
    isFolder = statSync(resolved).isDirectory();
  } catch {
    // Reported below.
  }
  if (!isFolder) throw new Error(`The server's root must be an existing folder; "${root}" is not one.`);
  return resolved;
}

function outside(given: string): Confined {
  return {
    ok: false,
    message: `"${given}" is outside the folder this server works in. Use a path inside it, written relative to it.`,
  };
}

/** An existing file named by the caller, confined to the root after links are followed. */
export async function existingInside(root: string, given: string, maxBytes: number = MAX_SCENEFILE_BYTES): Promise<Confined> {
  const candidate = resolvePath(root, given);
  if (!isInside(root, candidate)) return outside(given);
  try {
    const [realRoot, real] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!isInside(realRoot, real)) return outside(given);
    const info = await stat(real);
    if (!info.isFile()) return { ok: false, message: `"${given}" is a folder, not a file. Give the path of a file.` };
    if (info.size > maxBytes) return { ok: false, message: `"${given}" is too large to be read here.` };
    return { ok: true, path: real };
  } catch {
    return { ok: false, message: `There is no file "${given}" in the folder this server works in.` };
  }
}

/**
 * A file the caller wants written, which may not exist yet. Its nearest
 * existing folder is resolved through links and must be the root or inside
 * it, so a link cannot carry the write elsewhere. The path returned is built
 * on that resolved folder, so it can be compared with other resolved paths.
 */
export async function writableInside(root: string, given: string): Promise<Confined> {
  const candidate = resolvePath(root, given);
  if (!isInside(root, candidate)) return outside(given);
  const realRoot = await realpath(root);
  const pending: string[] = [basename(candidate)];
  let folder = dirname(candidate);
  for (;;) {
    try {
      const real = await realpath(folder);
      if (real !== realRoot && !isInside(realRoot, real)) return outside(given);
      return { ok: true, path: join(real, ...pending) };
    } catch {
      const parent = dirname(folder);
      if (parent === folder) return outside(given);
      pending.unshift(basename(folder));
      folder = parent;
    }
  }
}

/** True when two paths name the same file on disk, whatever their spelling or letter case. */
export async function sameFile(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  try {
    const [first, second] = await Promise.all([stat(a), stat(b)]);
    return first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
}
