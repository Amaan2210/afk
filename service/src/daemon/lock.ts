import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import path from "node:path";

/**
 * The name the lock is held under, derived from the lock file: a Windows named pipe, or on Linux
 * a socket in the abstract namespace. Either exists only while a process listens on it, and only
 * one process can.
 */
export function lockEndpoint(
  lockFile: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = path.resolve(lockFile);
  const key = platform === "win32" ? resolved.toLowerCase() : resolved;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return platform === "win32" ? `\\\\.\\pipe\\afk-${hash}` : `\0afk-${hash}`;
}

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** The pid in the lock file; undefined when the file is missing, unreadable or holds no pid. */
export async function readPid(lockFile: string): Promise<number | undefined> {
  let text: string;
  try {
    text = (await readFile(lockFile, "utf8")).trim();
  } catch {
    return undefined;
  }
  const pid = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * While we still listen, no other process can have taken the lock and written the file. The
 * endpoint is closed whatever happens to the file: it, not the file, is the lock.
 */
async function release(lockFile: string, server: Server): Promise<void> {
  try {
    if ((await readPid(lockFile)) === process.pid) await rm(lockFile, { force: true });
  } finally {
    await close(server);
  }
}

/**
 * Makes this process the only daemon for a config dir. The lock is the endpoint `lockEndpoint`
 * names, which this process listens on until released: the OS refuses a second listener and frees
 * the name when its holder exits, however it exits, so nothing is ever left stale. `lockFile` only
 * records the holder's pid, for the `already running (pid n)` a refused caller throws. Resolves
 * to a release function.
 */
export async function acquireLock(lockFile: string): Promise<() => Promise<void>> {
  const file = path.resolve(lockFile);
  await mkdir(path.dirname(file), { recursive: true });
  const server = createServer((socket) => socket.destroy());
  try {
    await listen(server, lockEndpoint(file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    const pid = await readPid(file);
    const message = pid === undefined ? "already running" : `already running (pid ${pid})`;
    throw new Error(message, { cause: err });
  }
  // Held for as long as the daemon runs, yet never what keeps the process alive.
  server.unref();
  // A failed accept must not crash the daemon; the endpoint stays held.
  server.on("error", () => undefined);
  try {
    await writeFile(file, String(process.pid));
  } catch (err) {
    await close(server);
    throw err;
  }
  let released: Promise<void> | undefined;
  return () => (released ??= release(file, server));
}
