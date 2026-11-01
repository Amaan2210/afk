import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { DaemonClient, DaemonError, DaemonNotRunningError } from "../../src/cli/client.js";
import { startDaemon, type Daemon } from "../../src/daemon/index.js";
import { afkPaths, type AfkPaths } from "../../src/daemon/paths.js";

const dirs: string[] = [];
const daemons: Daemon[] = [];
const clients: DaemonClient[] = [];
const servers: WebSocketServer[] = [];

async function configDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "afk-cli-"));
  dirs.push(dir);
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({ bind: "loopback", shell: "powershell.exe" }),
  );
  return dir;
}

async function startOn(dir: string): Promise<Daemon> {
  const daemon = await startDaemon({ configDir: dir, port: 0 });
  daemons.push(daemon);
  return daemon;
}

async function connect(paths: AfkPaths, port: number): Promise<DaemonClient> {
  const client = await DaemonClient.connectLocal(paths, port);
  clients.push(client);
  return client;
}

/** A WebSocket server that accepts connections and says nothing, or what `onConnect` sends. */
async function fakeServer(onConnect: (ws: import("ws").WebSocket) => void): Promise<number> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(wss);
  wss.on("connection", onConnect);
  await new Promise((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  for (const d of daemons.splice(0)) await d.stop();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("DaemonClient.connectLocal", () => {
  it("authenticates with the local token and resolves hello", async () => {
    const dir = await configDir();
    const daemon = await startOn(dir);
    const client = await connect(afkPaths(dir), daemon.port);
    expect(client.hello).toMatchObject({ type: "hello", device: { id: "local", name: "cli" } });
    expect(await client.sessions()).toEqual([]);
  });

  it("rejects with the daemon's reason when the token is refused", async () => {
    const dir = await configDir();
    const daemon = await startOn(dir);
    await writeFile(afkPaths(dir).localTokenFile, "not-the-token");
    await expect(DaemonClient.connectLocal(afkPaths(dir), daemon.port)).rejects.toMatchObject({
      name: "DaemonError",
      code: "unauthorized",
    });
  });

  it("reports a daemon that is not listening as not running", async () => {
    const dir = await configDir();
    const daemon = await startOn(dir);
    const port = daemon.port;
    await daemon.stop();
    await expect(DaemonClient.connectLocal(afkPaths(dir), port)).rejects.toBeInstanceOf(
      DaemonNotRunningError,
    );
  });

  it("reports a missing local token as not running", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afk-cli-"));
    dirs.push(dir);
    await expect(DaemonClient.connectLocal(afkPaths(dir), 1)).rejects.toBeInstanceOf(
      DaemonNotRunningError,
    );
  });

  it("gives up when no hello arrives in time", async () => {
    const dir = await configDir();
    await startOn(dir); // creates the local token
    let serverSide: WebSocket | undefined;
    const port = await fakeServer((ws) => (serverSide = ws));
    await expect(DaemonClient.connectLocal(afkPaths(dir), port, 50)).rejects.toThrow(
      /did not answer/,
    );
    await vi.waitFor(() => expect(serverSide?.readyState).toBe(WebSocket.CLOSED));
  });

  it("rejects on a malformed frame before hello", async () => {
    const dir = await configDir();
    await startOn(dir);
    const port = await fakeServer((ws) => ws.send("not json"));
    await expect(DaemonClient.connectLocal(afkPaths(dir), port)).rejects.toThrow(/malformed/);
  });
});

describe("DaemonClient.request", () => {
  it("correlates by id and rejects on error frames", async () => {
    const dir = await configDir();
    const daemon = await startOn(dir);
    const client = await connect(afkPaths(dir), daemon.port);

    const [list, missing] = await Promise.allSettled([
      client.request<{ devices: unknown[] }>({ type: "device.list" }),
      client.request({ type: "session.kill", sessionId: "s_nope" }),
    ]);
    expect(list).toMatchObject({ status: "fulfilled", value: { type: "ack", devices: [] } });
    expect(missing.status).toBe("rejected");
    const reason = (missing as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(DaemonError);
    expect(reason).toMatchObject({ code: "not_found" });
  });

  it("rejects when the socket closes before the reply", async () => {
    const dir = await configDir();
    await startOn(dir);
    const port = await fakeServer((ws) => {
      ws.send(JSON.stringify({ type: "hello" }));
      ws.on("message", (data) => {
        if (JSON.parse(String(data)).type !== "auth") ws.close();
      });
    });
    const client = await connect(afkPaths(dir), port);
    await expect(client.request({ type: "device.list" })).rejects.toThrow(/closed/);
    await expect(client.request({ type: "device.list" })).rejects.toThrow(/closed/);
  });
});

describe("DaemonClient.sessions", () => {
  it("rejects when the daemon closes before the snapshot", async () => {
    const dir = await configDir();
    await startOn(dir);
    const port = await fakeServer((ws) => {
      ws.send(JSON.stringify({ type: "hello" }));
      setTimeout(() => ws.close(), 20);
    });
    const client = await connect(afkPaths(dir), port);
    await expect(client.sessions()).rejects.toThrow(/closed/);
  });

  it("ignores a malformed frame after hello", async () => {
    const dir = await configDir();
    await startOn(dir);
    const port = await fakeServer((ws) => {
      ws.send(JSON.stringify({ type: "hello" }));
      ws.send("{oops");
      ws.send(JSON.stringify({ type: "sessions.snapshot", sessions: [] }));
    });
    const client = await connect(afkPaths(dir), port);
    expect(await client.sessions()).toEqual([]);
  });
});

describe("DaemonClient.send failure", () => {
  it("rejects the request and keeps no waiting entry", async () => {
    const dir = await configDir();
    await startOn(dir);
    const port = await fakeServer((ws) => ws.send(JSON.stringify({ type: "hello" })));
    const client = await connect(afkPaths(dir), port);
    vi.spyOn(client, "send").mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(client.request({ type: "device.list" })).rejects.toThrow("boom");
    expect((client as unknown as { waiting: Map<string, unknown> }).waiting.size).toBe(0);
  });
});

describe("DaemonClient.on", () => {
  it("delivers pushed frames until unsubscribed", async () => {
    const dir = await configDir();
    const port = await fakeServer((ws) => {
      ws.send(JSON.stringify({ type: "hello" }));
      ws.on("message", () => {
        ws.send(JSON.stringify({ type: "stats", n: 1 }));
        ws.send(JSON.stringify({ type: "stats", n: 2 }));
      });
    });
    await startOn(dir);
    const client = await connect(afkPaths(dir), port);
    const seen: unknown[] = [];
    const off = client.on("stats", (m) => {
      seen.push(m.n);
      if (m.n === 1) off();
    });
    client.send({ type: "ping" });
    await vi.waitFor(() => expect(seen).toEqual([1]));
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual([1]);
  });
});
