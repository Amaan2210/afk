import path from "node:path";
import { findOnPath } from "../../util/which.js";

export interface ShellInfo {
  exe: string;
  kind: "pwsh" | "powershell";
}

/** Locates an executable on PATH without spawning a process. */
export async function defaultWhich(name: string): Promise<string | undefined> {
  return findOnPath(name);
}

function kindOf(exe: string): ShellInfo["kind"] {
  // win32.basename splits on both separators, so a Windows path is read the same on any host.
  return path.win32.basename(exe).toLowerCase().startsWith("pwsh") ? "pwsh" : "powershell";
}

/**
 * The shell each session runs: the configured override if any, else PowerShell 7 (`pwsh`),
 * else Windows PowerShell 5.1.
 */
export async function detectShell(
  override?: string,
  which: (name: string) => Promise<string | undefined> = defaultWhich,
): Promise<ShellInfo> {
  if (override) return { exe: override, kind: kindOf(override) };
  const pwsh = await which("pwsh");
  if (pwsh) return { exe: pwsh, kind: "pwsh" };
  const powershell = await which("powershell");
  if (powershell) return { exe: powershell, kind: "powershell" };
  throw new Error(
    'No PowerShell found on PATH (looked for pwsh and powershell). Install PowerShell 7 or set "shell" in the afk config.',
  );
}

/** Runs the session profile and keeps the shell open; the user's own profile still loads. */
export function shellArgs(profilePath: string): string[] {
  return ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", profilePath];
}
