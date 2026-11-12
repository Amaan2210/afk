import { spawn } from "node:child_process";
import { get } from "node:http";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { readConfig } from "../daemon/config.js";
import type { AfkPaths } from "../daemon/paths.js";
import { CLI_ENTRY } from "../util/cli-entry.js";

const HEALTH_TIMEOUT_MS = 1000;
const START_WAIT_MS = 15_000;
const POLL_MS = 200;

/** Whether a daemon answers `GET /health` on 127.0.0.1:`port` within `timeoutMs`. Never rejects. */
export function isDaemonUp(port: number, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const options = { host: "127.0.0.1", port, path: "/health", agent: false, timeout: timeoutMs };
    const req = get(options, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/** What starting the daemon uses; everything has a default for the real machine. */
export interface StartIo {
  /** Starts `node cli.js <args>` so that it outlives this process, with no window. */
  spawnDetached?: (args: string[]) => Promise<void>;
  /** Whether a daemon answers on the port (default: a 1 s probe of 127.0.0.1). */
  isUp?: (port: number) => Promise<boolean>;
  /** How long to wait for it to answer (default 15 s). */
  waitMs?: number;
  /** How often to look meanwhile (default 200 ms). */
  pollMs?: number;
}

/**
 * Starts the daemon as its own hidden process. It is not this process's child in any way that
 * matters: it has no window to close, and closing this terminal does not end it. A session's own
 * variables are left out, for a daemon started from inside a session.
 */
function spawnDaemon(args: string[]): Promise<void> {
  const env = { ...process.env };
  delete env.AFK_SESSION_ID;
  delete env.AFK_PORT;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // Not the caller's folder, which the daemon would otherwise keep in use.
      cwd: os.homedir(),
      env,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Starts the daemon in the background (`afk daemon --background`, which stops itself once nothing
 * is left to serve) and waits until it answers. Resolves with the port it answers on: `port`, or
 * the configured one, which a first start writes. Rejects when it does not answer in time.
 */
export async function startInBackground(
  paths: AfkPaths,
  port?: number,
  io: StartIo = {},
): Promise<number> {
  const args = ["daemon", "--background", ...(port === undefined ? [] : ["--port", String(port)])];
  await (io.spawnDetached ?? spawnDaemon)(args);
  const isUp = io.isUp ?? ((p: number) => isDaemonUp(p));
  const deadline = Date.now() + (io.waitMs ?? START_WAIT_MS);
  for (;;) {
    const at = port ?? (await readConfig(paths))?.port;
    if (at !== undefined && (await isUp(at))) return at;
    if (Date.now() >= deadline) {
      throw new Error(`AFK did not start. Its log is in ${paths.logDir}.`);
    }
    await sleep(io.pollMs ?? POLL_MS);
  }
}
