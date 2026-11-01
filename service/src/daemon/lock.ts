import { readFile, rm, writeFile } from "node:fs/promises";

/** Tries to take a lock found stale this many times before giving up. */
const ATTEMPTS = 3;

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

/** The pid in the lock file; undefined when the file is gone or holds no valid pid. */
async function readPid(lockFile: string): Promise<number | undefined> {
  let text: string;
  try {
    text = (await readFile(lockFile, "utf8")).trim();
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    throw err;
  }
  const pid = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
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
 * Makes this process the only daemon for a config dir by creating `lockFile` with its pid. A lock
 * whose pid is not running (or that holds no pid) is stale and replaced; a live one makes this
 * throw `already running (pid n)`. Resolves to a release function that removes the file only
 * while it still holds this process's pid.
 */
export async function acquireLock(lockFile: string): Promise<() => Promise<void>> {
  const pid = process.pid;
  for (let attempt = 1; ; attempt++) {
    try {
      await writeFile(lockFile, String(pid), { flag: "wx" });
      return async () => {
        if ((await readPid(lockFile)) === pid) await rm(lockFile, { force: true });
      };
    } catch (err) {
      if (errorCode(err) !== "EEXIST" || attempt === ATTEMPTS) throw err;
    }
    const holder = await readPid(lockFile);
    if (holder !== undefined && isRunning(holder)) {
      throw new Error(`already running (pid ${holder})`);
    }
    await rm(lockFile, { force: true });
  }
}
