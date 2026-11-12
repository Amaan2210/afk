import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Server } from "node:net";
import { isDaemonUp, startInBackground } from "../../src/cli/autostart.js";
import { DaemonNotRunningError, type DaemonClient } from "../../src/cli/client.js";
import type { RunDeps } from "../../src/cli/run.js";
import { runService } from "../../src/cli/service.js";
import { afkPaths } from "../../src/daemon/paths.js";

const servers: { close(cb: () => void): unknown }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function listening<S extends Server>(server: S): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("isDaemonUp", () => {
  it("is true when /health answers 200", async () => {
    const paths: string[] = [];
    const server = createHttpServer((req, res) => {
      paths.push(req.url ?? "");
      res.end('{"ok":true}');
    });
    const port = await listening(server);
    expect(await isDaemonUp(port)).toBe(true);
    expect(paths).toEqual(["/health"]);
    server.closeAllConnections();
  });

  it("is false for another answer, and for a port nobody listens on", async () => {
    const server = createHttpServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    expect(await isDaemonUp(await listening(server))).toBe(false);
    server.closeAllConnections();

    const free = createTcpServer();
    const port = await listening(free);
    await new Promise<void>((resolve) => free.close(() => resolve()));
    servers.splice(servers.indexOf(free), 1);
    expect(await isDaemonUp(port)).toBe(false);
  });

  it("is false, within about a second, when the port accepts and never answers", async () => {
    const sockets: { destroy(): void }[] = [];
    const silent = createTcpServer((socket) => void sockets.push(socket));
    const port = await listening(silent);
    const since = Date.now();
    expect(await isDaemonUp(port)).toBe(false);
    const took = Date.now() - since;
    expect(took).toBeGreaterThanOrEqual(900);
    expect(took).toBeLessThan(1600);
    for (const s of sockets) s.destroy();
  });
});

describe("startInBackground", () => {
  const paths = afkPaths("/no-such-afk-config-dir");

  it("spawns `daemon --background` and resolves with the port once it answers", async () => {
    const spawned: string[][] = [];
    let probes = 0;
    const port = await startInBackground(paths, 4000, {
      spawnDetached: async (args) => void spawned.push(args),
      isUp: async () => ++probes > 2,
      pollMs: 1,
    });
    expect(port).toBe(4000);
    expect(spawned).toEqual([["daemon", "--background", "--port", "4000"]]);
  });

  it("names the log folder when the daemon never answers", async () => {
    const start = startInBackground(paths, 4000, {
      spawnDetached: async () => undefined,
      isUp: async () => false,
      waitMs: 10,
      pollMs: 1,
    });
    await expect(start).rejects.toThrow(/AFK did not start\. Its log is in .*logs/);
  });
});

describe("runService", () => {
  function setup(up: boolean): {
    deps: RunDeps;
    out: () => string;
    exit: ReturnType<typeof vi.fn>;
  } {
    let out = "";
    const exit = vi.fn();
    const client = {
      close: vi.fn(),
      sessions: async () => [{ state: "working" }, { state: "ended" }],
      request: async () => ({ devices: [{ name: "Pixel" }] }),
    } as unknown as DaemonClient;
    const deps: RunDeps = {
      paths: afkPaths("/cfg"),
      loadPort: async () => 2350,
      connect: async () => {
        if (!up) throw new DaemonNotRunningError("ECONNREFUSED");
        return client;
      },
      start: vi.fn(async () => 2350),
      stdout: { write: (s) => (out += s) },
      stderr: { write: (s) => (out += s) },
      setExitCode: exit,
    };
    return { deps, out: () => out, exit };
  }

  it("status says what a running daemon is serving, exit 0", async () => {
    const s = setup(true);
    await runService("status", {}, s.deps);
    expect(s.out()).toBe('Running on port 2350: 1 running session, paired with "Pixel".\n');
    expect(s.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("status says Not running, exit 1, and starts nothing", async () => {
    const s = setup(false);
    await runService("status", {}, s.deps);
    expect(s.out()).toBe("Not running\n");
    expect(s.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(s.deps.start).not.toHaveBeenCalled();
  });

  it("start starts a daemon that is down, and leaves a running one alone", async () => {
    const down = setup(false);
    await runService("start", {}, down.deps, { isUp: async () => false });
    expect(down.deps.start).toHaveBeenCalledOnce();
    expect(down.out()).toContain("Started AFK in the background.");

    const up = setup(true);
    await runService("start", {}, up.deps, { isUp: async () => true });
    expect(up.deps.start).not.toHaveBeenCalled();
    expect(up.out()).toBe("AFK is already running.\n");
  });

  it("stop says nothing is running when the daemon is down, exit 0", async () => {
    const s = setup(false);
    await runService("stop", {}, s.deps);
    expect(s.out()).toContain("AFK is not running");
    expect(s.exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
