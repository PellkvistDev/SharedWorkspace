import path from "node:path";
import fs from "node:fs/promises";
import { config } from "./config.js";

const ROOT = path.resolve(config.workspaceRoot);

export class PathError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PathError";
  }
}

// Normalize a user-supplied relative path and ensure it stays inside ROOT.
// Also rejects symlinks that resolve outside ROOT.
export async function resolveSafe(userPath: string): Promise<string> {
  const rel = (userPath || "").replace(/\\/g, "/");
  // Strip leading slashes so users can't accidentally escape with "/etc/passwd"
  const normalized = path.posix.normalize("/" + rel).replace(/^\/+/, "");
  const joined = path.resolve(ROOT, normalized);
  if (joined !== ROOT && !joined.startsWith(ROOT + path.sep)) {
    throw new PathError("path escapes workspace root");
  }
  // Resolve symlinks for components that exist
  try {
    const real = await fs.realpath(joined);
    if (real !== ROOT && !real.startsWith(ROOT + path.sep)) {
      throw new PathError("symlink escapes workspace root");
    }
    return real;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // File doesn't exist yet — check parent realpath
      const parent = path.dirname(joined);
      try {
        const realParent = await fs.realpath(parent);
        if (realParent !== ROOT && !realParent.startsWith(ROOT + path.sep)) {
          throw new PathError("symlink escapes workspace root");
        }
        return path.join(realParent, path.basename(joined));
      } catch (e: any) {
        if (e.code === "ENOENT") {
          // Multi-level new path; fall back to joined (still validated above)
          return joined;
        }
        throw e;
      }
    }
    throw err;
  }
}

export function toRelative(absPath: string): string {
  const rel = path.relative(ROOT, absPath);
  return rel.split(path.sep).join("/");
}

export function workspaceRoot(): string {
  return ROOT;
}
