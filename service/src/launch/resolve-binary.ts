import { fileURLToPath } from "node:url";
import { findOnPath } from "../util/which.js";

/** The afkdev package root: `service/` in the repo, `node_modules/afkdev` once installed. */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The real `claude` or `codex` executable: the first PATH hit, with PATHEXT on Windows.
 * Directories inside the afk package are skipped so afk can never resolve to its own files.
 */
export function resolveAgentBinary(
  name: "claude" | "codex",
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  skipDirs: string[] = [PACKAGE_ROOT],
): string | undefined {
  return findOnPath(name, { env, platform, skipDirs });
}
