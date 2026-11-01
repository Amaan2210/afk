import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalToken } from "../../src/daemon/config.js";
import { startDaemon, type Daemon } from "../../src/daemon/index.js";
import { afkPaths } from "../../src/daemon/paths.js";
import { VERSION } from "../../src/version.js";
import { TestClient } from "../helpers/ws-client.js";

const dirs: string[] = [];
const daemons: Daemon[] = [];
const clients: TestClient[] = [];

/**
 * A config dir whose config binds without Tailscale and names the shell, so the daemon starts the
 * same on any machine.
 */
async function configDir(config: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "afk-daemon-"));
  dirs.push(dir);
  const file = { bind: "loopback", shell: "powershell.exe", ...config };
  await writeFile(join(dir, "config.json"), JSON.stringify(file));
  return dir;
}

async function start(dir: string, port = 0): Promise<Daemon> {
  const daemon = await startDaemon({ configDir: dir, port });
  daemons.push(daemon);
  return daemon;
}

async function client(url: string, dir: string): Promise<TestClient> {
  const c = await TestClient.open(url);
  clients.push(c);
  await c.auth(await readLocalToken(afkPaths(dir)));
  return c;
}

async function readLog(dir: string): Promise<{ msg: string }[]> {
  const logDir = join(dir, "logs");
  const [file] = await readdir(logDir);
  const text = await readFile(join(logDir, file ?? ""), "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { msg: string });
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  for (const d of daemons.splice(0)) await d.stop();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("startDaemon", () => {
  it("startDaemon serves /health and accepts the local token over ws", async () => {
    const dir = await configDir();
    const d = await start(dir);
    expect(d.addresses).toEqual(["127.0.0.1"]);
    expect(d.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${d.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: VERSION });

    const c = await client(`ws://127.0.0.1:${d.port}/ws`, dir);
    expect(c.of("hello")[0]).toMatchObject({
      daemon: { version: VERSION },
      device: { id: "local", name: "cli" },
    });
    expect(c.invalid).toEqual([]);
  });

  it("second startDaemon on the same configDir fails with already running", async () => {
    const dir = await configDir();
    const first = await start(dir);
    const lockFile = afkPaths(dir).lockFile;

    await expect(startDaemon({ configDir: dir, port: 0 })).rejects.toThrow(
      `already running (pid ${process.pid})`,
    );
    expect(await readFile(lockFile, "utf8")).toBe(String(process.pid));
    expect((await fetch(`http://127.0.0.1:${first.port}/health`)).status).toBe(200);
  });

  it("stop is idempotent: closes clients, frees port and lock, flushes the log", async () => {
    const dir = await configDir();
    const d = await start(dir);
    const health = `http://127.0.0.1:${d.port}/health`;
    // A keep-alive connection stays open after this; stop must not wait for it to idle out.
    expect((await fetch(health)).status).toBe(200);
    const c = await client(`ws://127.0.0.1:${d.port}/ws`, dir);

    await Promise.all([d.stop(), d.stop()]);
    await d.stop();

    expect(await c.closed).toMatchObject({ code: 1001 });
    expect(existsSync(afkPaths(dir).lockFile)).toBe(false);
    await expect(fetch(health)).rejects.toThrow();
    const messages = (await readLog(dir)).map((l) => l.msg);
    expect(messages).toContain("daemon listening");
    expect(messages.at(-1)).toBe("daemon stopped");
  });

  it("serves every bound address on one port, sharing clients and config saves", async () => {
    const dir = await configDir({ bind: "127.0.0.2" });
    const d = await start(dir);
    expect(d.addresses).toEqual(["127.0.0.2", "127.0.0.1"]);

    const viaSecond = await client(`ws://127.0.0.2:${d.port}/ws`, dir);
    const viaLoopback = await client(`ws://127.0.0.1:${d.port}/ws`, dir);
    viaSecond.send({ type: "daemon.settings.set", id: "s1", settings: { retentionHours: 6 } });
    await viaSecond.next("daemon.settings", (f) => f.id === "s1");
    await viaLoopback.next("daemon.settings", (f) => f.settings.retentionHours === 6);

    const saved = JSON.parse(await readFile(afkPaths(dir).configFile, "utf8")) as {
      port: number;
      settings: { retentionHours: number };
    };
    expect(saved.settings.retentionHours).toBe(6);
    // The port given to startDaemon is for this run only.
    expect(saved.port).toBe(2350);
  });

  it("a failed listen closes what it opened and releases the lock", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = (blocker.address() as AddressInfo).port;
    // 127.0.0.2 listens first; 127.0.0.1 then fails.
    const dir = await configDir({ bind: "127.0.0.2" });

    try {
      await expect(startDaemon({ configDir: dir, port })).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
      expect(existsSync(afkPaths(dir).lockFile)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }

    const d = await start(dir, port);
    expect(d.port).toBe(port);
  });
});
