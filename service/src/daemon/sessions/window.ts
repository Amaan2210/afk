import { spawn } from "node:child_process";
import os from "node:os";
import type pino from "pino";
import { CLI_ENTRY } from "../../util/cli-entry.js";

/** What opening a window uses; tests replace the spawn and the platform. */
export interface WindowDeps {
  spawnWindow?: (
    file: string,
    args: string[],
  ) => { once(event: "error", cb: (err: Error) => void): unknown; unref(): void };
  platform?: NodeJS.Platform;
}

/** `afk attach <id> --own-window`, as arguments for node. */
export function windowArgs(sessionId: string, port: number): string[] {
  return [CLI_ENTRY, "attach", sessionId, "--port", String(port), "--own-window"];
}

/**
 * Opens a terminal window on this machine attached to the session, for one a phone started or
 * resumed, so that no session runs out of sight. On Windows a detached console program gets a
 * console window of its own, in the user's default terminal; the window closes when the session
 * ends, and closing it ends the session, as with any `afk attach`. Elsewhere there is no one way
 * to open a terminal, so nothing is opened and that is logged. Never throws: the session runs
 * either way.
 */
export function openSessionWindow(
  sessionId: string,
  port: number,
  log: pino.Logger,
  deps: WindowDeps = {},
): void {
  if ((deps.platform ?? process.platform) !== "win32") {
    log.warn({ sessionId }, "no window opened for the session: only Windows is supported");
    return;
  }
  const env = { ...process.env };
  delete env.AFK_SESSION_ID;
  delete env.AFK_PORT;
  const spawnWindow =
    deps.spawnWindow ??
    ((file: string, args: string[]) =>
      spawn(file, args, { detached: true, stdio: "ignore", cwd: os.homedir(), env }));
  try {
    const child = spawnWindow(process.execPath, windowArgs(sessionId, port));
    child.once("error", (err) => log.warn({ err, sessionId }, "the session's window did not open"));
    child.unref();
  } catch (err) {
    log.warn({ err, sessionId }, "the session's window did not open");
  }
}
