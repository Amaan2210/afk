import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Tries to take a lock found stale this many times before giving up. */
const ATTEMPTS = 3;

/** The lock files this process holds, so a lock naming our pid can be told from a stale one. */
const held = new Set<string>();

export interface LockOptions {
  /** When the machine booted, in ms since the epoch; defaults to now minus `os.uptime()`. */
  bootTime?: number;
}

interface LockInfo {
  /** Undefined when the file holds no valid pid. */
  pid?: number;
  mtimeMs: number;
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

/** The lock file's pid and age; undefined when the file is gone. */
async function readLock(lockFile: string): Promise<LockInfo | undefined> {
  try {
    const [raw, info] = await Promise.all([readFile(lockFile, "utf8"), stat(lockFile)]);
    const text = raw.trim();
    const pid = Number(text);
    const valid = /^\d+$/.test(text) && Number.isSafeInteger(pid) && pid > 0;
    return valid ? { pid, mtimeMs: info.mtimeMs } : { mtimeMs: info.mtimeMs };
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    throw err;
  }
}

/** Signal 0 checks that the process exists; EPERM means it exists but belongs to someone else. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) === "EPERM";
  }
}

/**
 * Windows reuses pids, so a pid alone can name an unrelated process: a lock written before the
 * last boot is stale whatever its pid, and one naming this process is stale unless we hold it.
 */
function isStale(lock: LockInfo, lockFile: string, bootTime: number): boolean {
  if (lock.pid === undefined || lock.mtimeMs < bootTime) return true;
  if (lock.pid === process.pid) return !held.has(lockFile);
  return !isRunning(lock.pid);
}

/**
 * Creates `lockFile` holding our pid, all at once: the pid is written to a file of our own, which
 * is then linked as the lock, so no reader ever sees a lock without its pid. False if it exists.
 */
async function tryCreate(lockFile: string): Promise<boolean> {
  const tmp = `${lockFile}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, String(process.pid));
  try {
    await link(tmp, lockFile);
    return true;
  } catch (err) {
    if (errorCode(err) === "EEXIST") return false;
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
}

async function release(lockFile: string): Promise<void> {
  if (!held.delete(lockFile)) return;
  if ((await readLock(lockFile))?.pid === process.pid) await rm(lockFile, { force: true });
}

/**
 * Makes this process the only daemon for a config dir by creating `lockFile` with its pid. A stale
 * lock (see `isStale`, or one that holds no pid) is replaced; a live one makes this throw
 * `already running (pid n)`. Resolves to a release function that removes the file only while it
 * still holds this process's pid.
 */
export async function acquireLock(
  lockFile: string,
  opts: LockOptions = {},
): Promise<() => Promise<void>> {
  const file = path.resolve(lockFile);
  const bootTime = opts.bootTime ?? Date.now() - os.uptime() * 1000;
  await mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (await tryCreate(file)) {
      held.add(file);
      return () => release(file);
    }
    const lock = await readLock(file);
    if (lock !== undefined && !isStale(lock, file, bootTime)) {
      throw new Error(`already running (pid ${lock.pid})`);
    }
    await rm(file, { force: true });
  }
  throw new Error(`could not acquire the daemon lock at ${file}`);
}
