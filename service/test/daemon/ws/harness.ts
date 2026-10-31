import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { vi, type Mock } from "vitest";
import type { ClientOptions } from "ws";
import { ChatHub } from "../../../src/daemon/agents/hub.js";
import { defaultConfig, type DaemonConfig, type DeviceRecord } from "../../../src/daemon/config.js";
import { RecentFolders } from "../../../src/daemon/fs.js";
import { KeepAwakeController } from "../../../src/daemon/keepawake.js";
import { afkPaths } from "../../../src/daemon/paths.js";
import type { PowerRequest } from "../../../src/daemon/power-request.js";
import { SessionRegistry } from "../../../src/daemon/sessions/registry.js";
import { StatsSampler } from "../../../src/daemon/stats.js";
import { hashToken } from "../../../src/daemon/tokens.js";
import { attachWsServer, type WsDeps } from "../../../src/daemon/ws/server.js";
import type { Session, SessionKind } from "../../../src/protocol/index.js";
import { VERSION } from "../../../src/version.js";
import { createFakePty, type FakePty } from "../../helpers/fake-pty.js";
import { TestClient } from "../../helpers/ws-client.js";

export const LOCAL_TOKEN = "local-token-for-tests";
export const PIXEL_TOKEN = "pixel-token-for-tests";
export const PIXEL: DeviceRecord = {
  id: "dev_pixel",
  name: "Pixel",
  tokenHash: hashToken(PIXEL_TOKEN),
  createdAt: "2026-10-30T09:00:00.000Z",
};
export const TAILSCALE_IP = "100.84.12.9";

export class FakePowerRequest implements PowerRequest {
  held = false;
  hold(): void {
    this.held = true;
  }
  release(): void {
    this.held = false;
  }
}

const fakeOs: Pick<typeof os, "freemem" | "totalmem" | "cpus"> = {
  totalmem: () => 16e9,
  freemem: () => 4e9,
  cpus: () => [{ model: "fake", speed: 1, times: { user: 1, nice: 0, sys: 0, idle: 3, irq: 0 } }],
};

export interface Harness {
  dir: string;
  url: string;
  ws: ReturnType<typeof attachWsServer>;
  registry: SessionRegistry;
  hub: ChatHub;
  stats: StatsSampler;
  power: FakePowerRequest;
  keepAwake: KeepAwakeController;
  recent: RecentFolders;
  config: DaemonConfig;
  saveConfig: Mock<(c: DaemonConfig) => Promise<void>>;
  /** Every log line the server wrote, parsed. */
  logs: Record<string, unknown>[];
  /** Connects without authenticating. */
  connect(path?: string, opts?: ClientOptions): Promise<TestClient>;
  /** Connects and authenticates; the greeting has arrived when it resolves. */
  client(token?: string): Promise<TestClient>;
  /** A session on a fake pty that has printed its prompt (so a claude launch line is typed). */
  session(kind?: SessionKind): Promise<{ session: Session; pty: FakePty }>;
  stop(): Promise<void>;
}

export async function startHarness(extra: Partial<WsDeps> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "afk-ws-"));
  const fakes = createFakePty();
  const registry = new SessionRegistry({
    ptyFactory: fakes.factory,
    shell: { exe: "powershell.exe", kind: "powershell" },
    sessionsDir: join(dir, "sessions"),
    port: 2350,
    nodeExe: "node.exe",
    cliEntry: "cli.js",
    ringBufferBytes: 4096,
    snapshotScrollback: 100,
    retentionHours: 24,
    baseEnv: {},
  });
  const hub = new ChatHub(registry, { pollMs: 20, exitGraceMs: 50 });
  const stats = new StatsSampler({ os: fakeOs });
  const power = new FakePowerRequest();
  const keepAwake = new KeepAwakeController(power, { graceMs: 600_000 });
  const recent = new RecentFolders(join(dir, "recent.json"));
  const config: DaemonConfig = {
    ...structuredClone(defaultConfig),
    localTokenHash: hashToken(LOCAL_TOKEN),
    devices: [structuredClone(PIXEL)],
  };
  const saveConfig = vi.fn<(c: DaemonConfig) => Promise<void>>(async () => undefined);
  const logs: Record<string, unknown>[] = [];
  const log = pino({ level: "debug" }, { write: (line: string) => logs.push(JSON.parse(line)) });

  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ws = attachWsServer(server, {
    config,
    paths: afkPaths(dir),
    registry,
    hub,
    stats,
    keepAwake,
    recent,
    version: VERSION,
    log,
    saveConfig,
    tailscaleIp: TAILSCALE_IP,
    answerChunkDelayMs: 1,
    ...extra,
  });

  const clients: TestClient[] = [];
  const connect: Harness["connect"] = async (path = "/ws", opts) => {
    const c = await TestClient.open(base + path, opts);
    clients.push(c);
    return c;
  };

  return {
    dir,
    url: `${base}/ws`,
    ws,
    registry,
    hub,
    stats,
    power,
    keepAwake,
    recent,
    config,
    saveConfig,
    logs,
    connect,
    async client(token = LOCAL_TOKEN) {
      const c = await connect();
      await c.auth(token);
      return c;
    },
    async session(kind = "shell") {
      const session = await registry.create({ cwd: dir, kind, args: [] });
      const pty = fakes.last;
      pty.emitData("PS> ");
      return { session, pty };
    },
    async stop() {
      for (const c of clients) c.terminate();
      await ws.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const s of registry.list()) hub.detach(s.id);
      registry.stopAll();
      keepAwake.dispose();
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
      const invalid = clients.flatMap((c) => c.invalid);
      if (invalid.length > 0)
        throw new Error(`frames off the protocol: ${JSON.stringify(invalid)}`);
    },
  };
}
