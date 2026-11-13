import { spawn } from "node:child_process";
import os from "node:os";
import type pino from "pino";
import { CLI_ENTRY } from "../../util/cli-entry.js";

/** What a spawned window process reports; a ChildProcess has both. */
export interface WindowChild {
  once(event: "error", cb: (err: Error) => void): unknown;
  once(event: "exit", cb: (code: number | null) => void): unknown;
  unref(): void;
}

/** What opening a window uses; tests replace the spawn and the platform. */
export interface WindowDeps {
  /** Runs `file` with `args` passed as they are, unquoted (cmd parses its own line). */
  spawnWindow?: (file: string, args: string[]) => WindowChild;
  platform?: NodeJS.Platform;
}

/** The window's title until `afk attach` sets its own. */
const WINDOW_TITLE = "AFK";

/** `afk attach <id> --own-window`, as arguments for node. */
export function windowArgs(sessionId: string, port: number): string[] {
  return [CLI_ENTRY, "attach", sessionId, "--port", String(port), "--own-window"];
}

/**
 * cmd's arguments to run `afk attach` in a console window of its own: `start` gives the program a
 * new console, in the user's default terminal. Every part after `start` is quoted (paths hold
 * spaces; a quoted `start` is not found), and `/s` makes cmd take the line between the outer
 * quotes as it is.
 */
export function windowCmdArgs(nodeExe: string, sessionId: string, port: number): string[] {
  const quoted = (s: string): string => `"${s}"`;
  const parts = [WINDOW_TITLE, nodeExe, ...windowArgs(sessionId, port)].map(quoted);
  return ["/d", "/s", "/c", quoted(["start", ...parts].join(" "))];
}

/**
 * Opens a terminal window on this machine attached to the session, for one a phone started or
 * resumed, so that no session runs out of sight. On Windows `cmd /c start` opens it, in the user's
 * default terminal: the daemon runs without a console, and a program it starts directly gets none
 * either, so it would run unseen. The window closes when the session ends, and closing it ends the
 * session, as with any `afk attach`. Elsewhere there is no one way to open a terminal, so nothing
 * is opened and that is logged. Never throws: the session runs either way.
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
      spawn(file, args, {
        // Detached, cmd itself gets no console; it is not hidden either, as `start` could pass
        // that on to the window it opens.
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true,
        cwd: os.homedir(),
        env,
      }));
  try {
    // process.env, not the copy: only it finds COMSPEC under any spelling.
    const cmd = process.env.ComSpec ?? "cmd.exe";
    const child = spawnWindow(cmd, windowCmdArgs(process.execPath, sessionId, port));
    child.once("error", (err) => log.warn({ err, sessionId }, "the session's window did not open"));
    // cmd ends as soon as `start` has started the window; a code other than 0 means it did not.
    child.once("exit", (code) => {
      if (code !== 0) log.warn({ code, sessionId }, "the session's window did not open");
    });
    child.unref();
  } catch (err) {
    log.warn({ err, sessionId }, "the session's window did not open");
  }
}
