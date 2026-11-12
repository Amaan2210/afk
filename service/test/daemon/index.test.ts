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

/**
 * A network whose "Tailscale" address (127.0.0.2, which binds on any CI machine) shows up once
 * `up` is set or after `upAfter` probes.
 */
function fakeTailscale(upAfter = Infinity) {
  const net = {
    up: false,
    probes: 0,
    onProbe: (): void => undefined,
    options: {
      interfaces: () => {
        net.probes++;
        net.onProbe();
        if (!net.up && net.probes <= upAfter) return {};
        return { Tailscale: [{ address: "127.0.0.2", family: "IPv4", internal: false }] };
      },
      isTailscale: (address: string) => address === "127.0.0.2",
    },
  };
  return net;
}

describe("startDaemon with bind tailscale", () => {
  const tailscaleConfig = { bind: "tailscale" };

  it("waits for the Tailscale address at start and listens on it once it appears", async () => {
    const dir = await configDir(tailscaleConfig);
    const net = fakeTailscale(2);
    const lines: string[] = [];
    const d = await startDaemon({
      configDir: dir,
      port: 0,
      print: (line) => lines.push(line),
      tailscale: { ...net.options, startWaitMs: 5000, startPollMs: 10 },
    });
    daemons.push(d);

    expect(d.addresses).toEqual(["127.0.0.2", "127.0.0.1"]);
    expect(d.warning).toBeUndefined();
    expect(lines).toEqual(["waiting for Tailscale…"]);
    expect(net.probes).toBe(3);
    await d.stop();
    expect((await readLog(dir)).map((l) => l.msg)).toContain("waiting for Tailscale");
  });

  it("a start waiting for Tailscale gives up at once when its signal fires", async () => {
    const dir = await configDir(tailscaleConfig);
    const net = fakeTailscale();
    const controller = new AbortController();
    const since = Date.now();
    setTimeout(() => controller.abort(), 50);
    await expect(
      startDaemon({
        configDir: dir,
        port: 0,
        signal: controller.signal,
        tailscale: { ...net.options, startWaitMs: 60_000, startPollMs: 60_000 },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - since).toBeLessThan(2000);
    expect(existsSync(afkPaths(dir).lockFile)).toBe(false);
    const messages = (await readLog(dir)).map((l) => l.msg);
    expect(messages).toContain("daemon stopped while it started");
    expect(messages).not.toContain("daemon failed to start");
  });

  it("falls back to 127.0.0.1 with a warning when none appears in time", async () => {
    const dir = await configDir(tailscaleConfig);
    const net = fakeTailscale();
    const d = await startDaemon({
      configDir: dir,
      port: 0,
      tailscale: { ...net.options, startWaitMs: 60, startPollMs: 10 },
    });
    daemons.push(d);

    expect(d.addresses).toEqual(["127.0.0.1"]);
    expect(d.warning).toMatch(/No Tailscale address/);
    expect(net.probes).toBeGreaterThan(2);
  });

  it("listens on a Tailscale address that appears later and reports it in hello", async () => {
    const dir = await configDir(tailscaleConfig);
    const net = fakeTailscale();
    const lines: string[] = [];
    const d = await startDaemon({
      configDir: dir,
      port: 0,
      print: (line) => lines.push(line),
      tailscale: { ...net.options, startWaitMs: 0, reprobeMs: 20 },
    });
    daemons.push(d);
    expect(d.addresses).toEqual(["127.0.0.1"]);
    const before = await client(`ws://127.0.0.1:${d.port}/ws`, dir);
    expect(before.of("hello")[0]?.daemon.tailscaleIp).toBeUndefined();

    net.up = true;
    const health = `http://127.0.0.2:${d.port}/health`;
    await vi.waitFor(async () => expect((await fetch(health)).status).toBe(200), {
      timeout: 3000,
      interval: 20,
    });
    expect(d.addresses).toEqual(["127.0.0.2", "127.0.0.1"]);
    expect(d.warning).toBeUndefined();
    expect(lines).toContain(`listening on 127.0.0.2:${d.port} too (Tailscale)`);
    const probes = net.probes;

    const via = await client(`ws://127.0.0.2:${d.port}/ws`, dir);
    expect(via.of("hello")[0]?.daemon.tailscaleIp).toBe("127.0.0.2");
    const loopback = await client(`ws://127.0.0.1:${d.port}/ws`, dir);
    expect(loopback.of("hello")[0]?.daemon.tailscaleIp).toBe("127.0.0.2");
    // Bound once: the daemon stops looking.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(net.probes).toBe(probes);

    await d.stop();
    expect(await via.closed).toMatchObject({ code: 1001 });
    await expect(fetch(health)).rejects.toThrow();
    const messages = (await readLog(dir)).map((l) => l.msg);
    expect(messages).toContain("listening on the Tailscale address that appeared");
  });

  it("a stop while the new address is being bound leaves nothing listening", async () => {
    const dir = await configDir(tailscaleConfig);
    const net = fakeTailscale();
    const d = await startDaemon({
      configDir: dir,
      port: 0,
      tailscale: { ...net.options, startWaitMs: 0, reprobeMs: 20 },
    });
    daemons.push(d);
    let stopping: Promise<void> | undefined;
    net.onProbe = () => {
      if (!net.up) return;
      // Stops after the probe has found the address, while its server starts to listen.
      queueMicrotask(() => (stopping ??= d.stop()));
    };
    net.up = true;

    await vi.waitFor(() => expect(stopping).toBeDefined(), { timeout: 3000, interval: 10 });
    await stopping;
    await expect(fetch(`http://127.0.0.2:${d.port}/health`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${d.port}/health`)).rejects.toThrow();
    const probes = net.probes;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(net.probes).toBe(probes);
  });
});

describe("startDaemon: pairing and stopping", () => {
  const PHONE = { id: "dev_1", name: "Pixel", tokenHash: "x", createdAt: "2026-01-01T00:00:00Z" };

  async function savedDevices(dir: string): Promise<unknown[]> {
    const text = await readFile(join(dir, "config.json"), "utf8");
    return (JSON.parse(text) as { devices: unknown[] }).devices;
  }

  it("a phone paired in an earlier run is unpaired when the daemon starts", async () => {
    const dir = await configDir({ devices: [PHONE] });
    await start(dir);
    expect(await savedDevices(dir)).toEqual([]);
  });

  it("daemon.stop unpairs the phone, acks, then asks whoever started the daemon to stop it", async () => {
    const dir = await configDir();
    const reasons: string[] = [];
    const daemon = await startDaemon({
      configDir: dir,
      port: 0,
      onStopRequested: (reason) => reasons.push(reason),
    });
    daemons.push(daemon);
    const cli = await client(`ws://127.0.0.1:${daemon.port}/ws`, dir);
    expect(await cli.request({ type: "device.add", name: "Pixel" })).toMatchObject({ type: "ack" });
    expect(await savedDevices(dir)).toHaveLength(1);

    expect(await cli.request({ type: "daemon.stop" })).toMatchObject({ type: "ack" });
    await vi.waitFor(() => expect(reasons).toEqual(["stop asked by the CLI"]));
    expect(await savedDevices(dir)).toEqual([]);
  });

  it("daemon.stop is refused by a daemon that was given no way to stop", async () => {
    const dir = await configDir();
    const daemon = await start(dir);
    const cli = await client(`ws://127.0.0.1:${daemon.port}/ws`, dir);
    expect(await cli.request({ type: "daemon.stop" })).toMatchObject({
      type: "error",
      code: "internal",
    });
  });

  it("stopWhenIdle asks to stop once the last client has left and nothing is left to serve", async () => {
    const dir = await configDir();
    const reasons: string[] = [];
    const daemon = await startDaemon({
      configDir: dir,
      port: 0,
      onStopRequested: (reason) => reasons.push(reason),
      stopWhenIdle: true,
      idleStopMs: 20,
    });
    daemons.push(daemon);
    const cli = await client(`ws://127.0.0.1:${daemon.port}/ws`, dir);
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Nobody has left yet: a daemon that is being used, or not used yet, keeps waiting.
    expect(reasons).toEqual([]);

    cli.terminate();
    await vi.waitFor(() => expect(reasons).toHaveLength(1));
    expect(reasons[0]).toMatch(/^idle/);
  });

  it("stopWhenIdle keeps running while a phone is paired", async () => {
    const dir = await configDir();
    const reasons: string[] = [];
    const daemon = await startDaemon({
      configDir: dir,
      port: 0,
      onStopRequested: (reason) => reasons.push(reason),
      stopWhenIdle: true,
      idleStopMs: 20,
    });
    daemons.push(daemon);
    const cli = await client(`ws://127.0.0.1:${daemon.port}/ws`, dir);
    await cli.request({ type: "device.add", name: "Pixel" });
    cli.terminate();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reasons).toEqual([]);
  });
});
