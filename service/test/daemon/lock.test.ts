import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock, lockEndpoint } from "../../src/daemon/lock.js";

const SERVICE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOCK_MODULE = new URL("../../src/daemon/lock.ts", import.meta.url).href;

/** Takes the lock given on the command line, says so, and holds it until killed. */
const HOLDER = `
const [lockModule, lockFile] = process.argv.slice(2);
const { acquireLock } = await import(lockModule);
await acquireLock(lockFile);
console.log("locked");
setInterval(() => {}, 1 << 30);
`;

let dir: string;
let lockFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-lock-"));
  lockFile = join(dir, "daemon.lock");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Another process holding the lock; resolves once it has taken it. */
async function holder(): Promise<ChildProcess> {
  const script = join(dir, "holder.mjs");
  await writeFile(script, HOLDER);
  const child = spawn(process.execPath, ["--import", "tsx", script, LOCK_MODULE, lockFile], {
    cwd: SERVICE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stderr?.on("data", (d) => (err += String(d)));
  await new Promise<void>((resolve, reject) => {
    child.stdout?.on("data", (d) => {
      out += String(d);
      if (out.includes("locked")) resolve();
    });
    child.once("exit", (code) =>
      reject(new Error(`holder exited (${code}) before locking: ${err}`)),
    );
  });
  return child;
}

/** Ends `child` the way a crash or Task Manager would: no handlers, no cleanup. */
async function hardKill(child: ChildProcess): Promise<void> {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") spawnSync("taskkill", ["/F", "/PID", String(child.pid)]);
  else child.kill("SIGKILL");
  await exited;
}

describe("lockEndpoint", () => {
  it("names a Windows pipe after the lock file, whatever its case", () => {
    const name = lockEndpoint(join(dir, "daemon.lock"), "win32");
    expect(name).toMatch(/^\\\\\.\\pipe\\afk-[0-9a-f]{16}$/);
    expect(lockEndpoint(join(dir, "DAEMON.LOCK"), "win32")).toBe(name);
    expect(lockEndpoint(join(dir, "other.lock"), "win32")).not.toBe(name);
  });

  it("names an abstract unix socket elsewhere", () => {
    expect(lockEndpoint(join(dir, "daemon.lock"), "linux")).toMatch(/^\0afk-[0-9a-f]{16}$/);
  });
});

describe("acquireLock", () => {
  it("writes our pid to the lock file and removes it on release", async () => {
    const release = await acquireLock(lockFile);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
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

  it("refuses a second holder in this process, and takes it again once released", async () => {
    const release = await acquireLock(lockFile);
    await expect(acquireLock(lockFile)).rejects.toThrow(`already running (pid ${process.pid})`);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await release();

    const again = await acquireLock(lockFile);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await again();
  });

  it("lets each lock file be held at the same time", async () => {
    const first = await acquireLock(lockFile);
    const second = await acquireLock(join(dir, "other", "daemon.lock"));
    await second();
    await first();
  });

  it("refuses without a pid when the holder's pid file is gone", async () => {
    const release = await acquireLock(lockFile);
    await rm(lockFile);
    await expect(acquireLock(lockFile)).rejects.toThrow(/^already running$/);
    await release();
  });

  it("is not blocked by a pid file nobody holds the lock for", async () => {
    await writeFile(lockFile, "garbage");
    const release = await acquireLock(lockFile);
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    await release();
  });

  it("release leaves a pid file another process has written since", async () => {
    const release = await acquireLock(lockFile);
    await writeFile(lockFile, "4242");
    await release();
    expect(await readFile(lockFile, "utf8")).toBe("4242");
  });

  it("is held by another process until it dies, however it dies", async () => {
    const child = await holder();
    try {
      await expect(acquireLock(lockFile)).rejects.toThrow(`already running (pid ${child.pid})`);
      await hardKill(child);
      // The killed holder's pid file is still there; it does not matter.
      expect(await readFile(lockFile, "utf8")).toBe(String(child.pid));
      const release = await acquireLock(lockFile);
      expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
      await release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 30_000);
});
