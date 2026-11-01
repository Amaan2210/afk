import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isRecord } from "../util/is-record.js";
import { findOnPath } from "../util/which.js";

/** `statusLine.command` of a settings file; undefined when missing, unreadable or invalid. */
function commandIn(file: string): string | undefined {
  try {
    const settings: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(settings) || !isRecord(settings.statusLine)) return undefined;
    const { command } = settings.statusLine;
    return typeof command === "string" && command.trim() !== "" ? command : undefined;
  } catch {
    return undefined;
  }
}

export interface OriginalLookup {
  projectDir: string;
  env: NodeJS.ProcessEnv;
  userSettingsPath?: string;
}

/**
 * The status line the user had before AFK took the slot: project local settings, project
 * settings, then user settings. Reads only; no settings file is ever written.
 */
export function findOriginalStatusline(o: OriginalLookup): string | undefined {
  const userFile =
    o.userSettingsPath ??
    path.join(o.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), "settings.json");
  const candidates = [
    path.join(o.projectDir, ".claude", "settings.local.json"),
    path.join(o.projectDir, ".claude", "settings.json"),
    userFile,
  ];
  for (const file of candidates) {
    const command = commandIn(file);
    if (command !== undefined) return command;
  }
  return undefined;
}

/** Git Bash on Windows: `CLAUDE_CODE_GIT_BASH_PATH`, else `bash.exe` beside the `git.exe` on PATH. */
export function findGitBash(env: NodeJS.ProcessEnv): string | undefined {
  if (env.CLAUDE_CODE_GIT_BASH_PATH) return env.CLAUDE_CODE_GIT_BASH_PATH;
  const git = findOnPath("git", { env, platform: "win32" });
  if (git === undefined) return undefined;
  // The usual spot is root/cmd/git.exe; root/mingw64/bin/git.exe is one level deeper.
  let dir = path.dirname(git);
  for (let i = 0; i < 3; i++) {
    dir = path.dirname(dir);
    const bash = path.join(dir, "bin", "bash.exe");
    if (existsSync(bash)) return bash;
  }
  return undefined;
}
