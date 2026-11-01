import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isRecord } from "../util/is-record.js";

/** Starts the user's notify program; it must not wait for it. */
export type NotifySpawn = (file: string, args: string[], env: NodeJS.ProcessEnv) => void;

export interface UserNotifyIo {
  env: NodeJS.ProcessEnv;
  /** Default: detached, without a window, its output ignored. */
  spawn?: NotifySpawn;
  /** Where `~/.codex` is when CODEX_HOME is not set (default: the user's home folder). */
  homedir?: () => string;
}

/** Set in the user's notify program's environment, so that `afk hook` never chains twice. */
const CHAINED = "AFK_NOTIFY_CHAINED";

/**
 * The `notify` command of the user's Codex config (`$CODEX_HOME/config.toml`, by default
 * `~/.codex/config.toml`), or undefined when it sets none. The file is only read; a missing or
 * unreadable file, and a `notify` that is not a non-empty list of strings, count as none.
 * Profiles (`[profiles.x] notify`) are not looked at.
 */
export async function userNotifyCommand(
  env: NodeJS.ProcessEnv,
  homedir: () => string = os.homedir,
): Promise<string[] | undefined> {
  const codexHome = env.CODEX_HOME || path.join(homedir(), ".codex");
  let text: string;
  try {
    text = await readFile(path.join(codexHome, "config.toml"), "utf8");
  } catch {
    return undefined;
  }
  // Loaded here only: most hooks never need a TOML parser.
  const { parse } = await import("smol-toml");
  let config: unknown;
  try {
    config = parse(text);
  } catch {
    return undefined;
  }
  const notify = isRecord(config) ? config.notify : undefined;
  if (!Array.isArray(notify) || notify.length === 0) return undefined;
  return notify.every((item) => typeof item === "string") ? notify : undefined;
}

function spawnDetached(file: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(file, args, { env, detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

/**
 * Runs the user's own Codex `notify` program with `payload` as its last argument, as Codex
 * would have: an AFK session's Codex runs `afk hook codex-notify` in its place. The program
 * starts detached and is not waited for; its environment drops the session's AFK variables.
 * Never throws: a program that cannot start is ignored, as Codex ignores a failing notify.
 */
export async function runUserNotify(payload: string, io: UserNotifyIo): Promise<void> {
  try {
    if (io.env[CHAINED]) return;
    const command = await userNotifyCommand(io.env, io.homedir);
    if (command === undefined) return;
    const [file = "", ...args] = command;
    const env: NodeJS.ProcessEnv = { ...io.env, [CHAINED]: "1" };
    delete env.AFK_SESSION_ID;
    delete env.AFK_PORT;
    (io.spawn ?? spawnDetached)(file, [...args, payload], env);
  } catch {
    // The user's notify is theirs to fix; it never fails the hook.
  }
}
