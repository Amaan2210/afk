import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderClaudeSettings } from "./claude-settings.js";

export interface LaunchContext {
  sessionId: string;
  port: number;
  nodeExe: string;
  cliEntry: string;
  sessionDir: string;
  userArgs: string[];
  realBinary: string;
}

export interface LaunchSpec {
  exe: string;
  args: string[];
  env: Record<string, string>;
  filesWritten: string[];
}

const CLAUDE_SETTINGS_FILE = "claude-settings.json";

function sessionEnv(c: LaunchContext): Record<string, string> {
  return { AFK_SESSION_ID: c.sessionId, AFK_PORT: String(c.port) };
}

/** A TOML basic string: backslashes doubled, double quotes escaped. */
function tomlString(s: string): string {
  return `"${s.replace(/[\\"]/g, "\\$&")}"`;
}

/** Claude Code gets this session's hooks and status line through `--settings <file>`. */
export async function buildClaudeLaunch(c: LaunchContext): Promise<LaunchSpec> {
  await mkdir(c.sessionDir, { recursive: true });
  const file = path.join(c.sessionDir, CLAUDE_SETTINGS_FILE);
  await writeFile(file, JSON.stringify(renderClaudeSettings(c), null, 2) + "\n", "utf8");
  return {
    exe: c.realBinary,
    args: ["--settings", file, ...c.userArgs],
    env: sessionEnv(c),
    filesWritten: [file],
  };
}

/** Codex gets the turn-complete relay through a `-c notify=[...]` config override. */
export function buildCodexLaunch(c: LaunchContext): LaunchSpec {
  const notify = [c.nodeExe, c.cliEntry, "hook", "codex-notify"].map(tomlString).join(",");
  return {
    exe: c.realBinary,
    args: ["-c", `notify=[${notify}]`, ...c.userArgs],
    env: sessionEnv(c),
    filesWritten: [],
  };
}
