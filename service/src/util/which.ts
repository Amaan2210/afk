import { statSync } from "node:fs";
import path from "node:path";

export interface FindOnPathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Directories to ignore while scanning PATH, together with everything beneath them. */
  skipDirs?: string[];
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Environment lookup; Windows variable names are case-insensitive (`Path` vs `PATH`). */
function readEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * File names to probe in each PATH directory, in order. On Windows every PATHEXT extension
 * comes before the bare name: npm puts an extensionless sh shim next to `codex.cmd`, and
 * Windows cannot run the sh shim.
 */
function candidateNames(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [name];
  const exts = (readEnv(env, "PATHEXT", platform) || DEFAULT_PATHEXT)
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return [...exts.map((e) => name + e), name];
}

function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const delimiter = platform === "win32" ? ";" : ":";
  return (readEnv(env, "PATH", platform) ?? "")
    .split(delimiter)
    .map((d) => (platform === "win32" ? d.trim().replace(/^"(.*)"$/, "$1") : d))
    .filter((d) => d.length > 0);
}

/** True when `dir` is `root` or lies beneath it. Probes the real file system, so host paths. */
function isWithin(dir: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

function isRegularFile(file: string): boolean {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

/**
 * Locates an executable on PATH the way the platform's shell would, without spawning a
 * process. `platform` selects PATH and PATHEXT semantics; the file system probed is always
 * the real one.
 */
export function findOnPath(name: string, opts: FindOnPathOptions = {}): string | undefined {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const skipDirs = opts.skipDirs ?? [];
  const names = candidateNames(name, env, platform);
  for (const dir of pathDirs(env, platform)) {
    if (skipDirs.some((root) => isWithin(dir, root))) continue;
    for (const file of names) {
      const full = path.join(dir, file);
      if (isRegularFile(full)) return full;
    }
  }
  return undefined;
}
