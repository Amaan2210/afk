import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../../src/daemon/lock.js";

let dir: string;
let lockFile: string;

/** The pid of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  expect(child.status).toBe(0);
  return child.pid;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-lock-"));
  lockFile = join(dir, "daemon.lock");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("acquireLock", () => {
  it("writes our pid, leaves no temp file, and removes the lock on release", async () => {
    const release = await acquireLock(lockFile);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    expect(await readdir(dir)).toEqual(["daemon.lock"]);
    await release();
    expect(existsSync(lockFile)).toBe(false);
    await release();
  });

  it("creates the lock's folder", async () => {
    const nested = join(dir, "a", "b", "daemon.lock");
    const release = await acquireLock(nested);
    expect(await readFile(nested, "utf8")).toBe(String(process.pid));
    await release();
  });

  it("refuses while this process holds the lock", async () => {
    const release = await acquireLock(lockFile);
    await expect(acquireLock(lockFile)).rejects.toThrow(`already running (pid ${process.pid})`);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await release();
  });

  it("refuses while another live process holds the lock", async () => {
    await writeFile(lockFile, String(process.ppid));
    await expect(acquireLock(lockFile)).rejects.toThrow(`already running (pid ${process.ppid})`);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.ppid));
  });

  it("replaces a lock left by a process that has exited", async () => {
    await writeFile(lockFile, String(deadPid()));
    const release = await acquireLock(lockFile);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await release();
  });

  it("replaces a lock written before the last boot, whatever process has its pid now", async () => {
    await writeFile(lockFile, String(process.ppid));
    const written = (await stat(lockFile)).mtimeMs;
    const release = await acquireLock(lockFile, { bootTime: written + 1000 });
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await release();
  });

  it("replaces a lock naming this process that this process does not hold", async () => {
    // A process before the last restart had our pid; we never took this lock.
    await writeFile(lockFile, String(process.pid));
    const release = await acquireLock(lockFile);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it.each(["", "garbage", "0", "-4", "12abc"])("replaces a lock holding %j", async (text) => {
    await writeFile(lockFile, text);
    const release = await acquireLock(lockFile);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await release();
  });

  it("release leaves a lock another process has taken since", async () => {
    const release = await acquireLock(lockFile);
    await writeFile(lockFile, "4242");
    await release();
    expect(await readFile(lockFile, "utf8")).toBe("4242");
  });
});
