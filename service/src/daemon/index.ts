import { createServer, type RequestListener, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pino from "pino";
import { VERSION } from "../version.js";
import { ChatHub } from "./agents/hub.js";
import { loadConfig, saveConfig } from "./config.js";
import { RecentFolders } from "./fs.js";
import { createHttpHandler, type HttpHandler } from "./http.js";
import { followSessions, KeepAwakeController } from "./keepawake.js";
import { acquireLock } from "./lock.js";
import { closeLogger, createLogger } from "./logger.js";
import { closeServer, deferredListener, listenAll } from "./net.js";
import { afkPaths, defaultConfigDir, type AfkPaths } from "./paths.js";
import { createPowerRequest } from "./power-request.js";
import {
  listenWhenTailscaleAppears,
  planBind,
  type Rebinder,
  type TailscaleOptions,
} from "./rebind.js";
import { nodePtyFactory } from "./sessions/pty.js";
import { SessionRegistry } from "./sessions/registry.js";
import { detectShell } from "./sessions/shell.js";
import { StatsSampler } from "./stats.js";
import { attachWsServer, type WsDeps, type WsServer } from "./ws/server.js";

const PRUNE_INTERVAL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;

/**
 * The CLI that session shells run for `claude` and `codex`: the package's built dist/cli.js, which
 * this path reaches from dist/daemon/index.js and from src/daemon/index.ts (tsx, tests) alike.
 */
const CLI_ENTRY = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

export interface DaemonOptions {
  /** Defaults to `defaultConfigDir()`. */
  configDir?: string;
  /** Replaces the configured port for this run only (it is not saved); 0 picks a free port. */
  port?: number;
  /** Logs at debug level, to stdout as well as to the log file. */
  verbose?: boolean;
  /** Tells the person who started the daemon what it is doing (waiting, a new address). */
  print?: (line: string) => void;
  /** How the daemon looks for the Tailscale address; tests inject a network and short waits. */
  tailscale?: TailscaleOptions;
}

export interface Daemon {
  port: number;
  addresses: string[];
  /** Why the daemon listens on fewer addresses than configured. */
  warning?: string;
  log: pino.Logger;
  /** Ends every session, stops listening and releases the lock; later calls do nothing more. */
  stop(): Promise<void>;
}

/** What has been started so far, so that a failed start and `stop()` undo exactly that. */
interface Parts {
  log: pino.Logger;
  servers: Server[];
  release?: () => Promise<void>;
  registry?: SessionRegistry;
  hub?: ChatHub;
  stats?: StatsSampler;
  keepAwake?: KeepAwakeController;
  unfollow?: () => void;
  handler?: HttpHandler;
  ws?: WsServer;
  pruneTimer?: NodeJS.Timeout;
  rebind?: Rebinder;
}

type Started = Pick<Daemon, "port" | "addresses" | "warning">;

/** Where Codex keeps its rollouts: `$CODEX_HOME/sessions`, `~/.codex/sessions` by default. */
function codexSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
}

function httpServer(listener: RequestListener): Server {
  const server = createServer(listener);
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}

/** Stops whatever `p` holds, in reverse order of need; a step that fails does not stop the rest. */
async function teardown(p: Parts): Promise<void> {
  const steps: [string, () => unknown][] = [
    // First: once it resolves, no server is being added any more.
    ["rebind", () => p.rebind?.stop()],
    ["timers", () => clearInterval(p.pruneTimer)],
    ["ws", () => p.ws?.close()],
    ["http", () => p.handler?.dispose()],
    ["servers", () => Promise.all(p.servers.map(closeServer))],
    [
      "sessions",
      () => {
        // Exits arriving after this must not take the power request again.
        p.unfollow?.();
        for (const s of p.registry?.list() ?? []) p.hub?.detach(s.id);
        p.registry?.stopAll();
      },
    ],
    ["stats", () => p.stats?.stop()],
    ["keep-awake", () => p.keepAwake?.dispose()],
    ["lock", () => p.release?.()],
  ];
  for (const [step, run] of steps) {
    try {
      await run();
    } catch (err) {
      p.log.warn({ err, step }, "daemon: a stop step failed");
    }
  }
}

/**
 * Starts every part into `p`. The object it resolves to is the daemon's own: a Tailscale address
 * that appears later is added to its `addresses` (and clears its `warning`).
 */
async function compose(
  p: Parts,
  paths: AfkPaths,
  opts: DaemonOptions,
  startedAt: number,
): Promise<Started> {
  const { log } = p;
  const print = opts.print ?? (() => undefined);
  const tailscale = opts.tailscale ?? {};
  // Before the config is read: a second daemon must not rewrite the running one's files.
  p.release = await acquireLock(paths.lockFile);
  const config = await loadConfig(paths, {
    onCorrupt: (backup) =>
      log.warn({ backup }, "config was unreadable; moved aside, defaults used"),
  });
  const shell = await detectShell(config.shell);
  const bind = await planBind(config.bind, tailscale, () => {
    log.info("waiting for Tailscale");
    print("waiting for Tailscale…");
  });
  if (bind.warning !== undefined) log.warn(bind.warning);

  // The sessions need the port, which is only known once the servers listen.
  const forwarder = deferredListener();
  const requested = opts.port ?? config.port;
  const create = () => httpServer(forwarder.listener);
  const port = await listenAll(bind.addresses, requested, create, p.servers);
  for (const server of p.servers) {
    server.on("error", (err) => log.error({ err }, "http server error"));
  }

  const registry = (p.registry = new SessionRegistry({
    ptyFactory: nodePtyFactory,
    shell,
    sessionsDir: paths.sessionsDir,
    port,
    nodeExe: process.execPath,
    cliEntry: CLI_ENTRY,
    ringBufferBytes: config.ringBufferBytes,
    snapshotScrollback: config.snapshotScrollback,
    retentionHours: config.settings.retentionHours,
  }));
  const hub = (p.hub = new ChatHub(registry, {
    onError: (sessionId, err) => log.warn({ err, sessionId }, "chat: reading an agent file failed"),
  }));
  const keepAwake = (p.keepAwake = new KeepAwakeController(createPowerRequest(), {
    graceMs: config.settings.keepAwakeGraceMin * 60_000,
  }));
  keepAwake.setEnabled(config.settings.keepAwake);
  p.unfollow = followSessions(keepAwake, registry);
  const stats = (p.stats = new StatsSampler());
  stats.start(() => keepAwake.active);

  const handler = (p.handler = createHttpHandler({
    registry,
    hub,
    version: VERSION,
    codexSessionsDir: codexSessionsDir(),
    log,
    startedAt,
  }));
  // `hello` reads `tailscaleIp` from here when it is sent, so a later address shows up in it.
  const wsDeps: WsDeps = {
    config,
    paths,
    registry,
    hub,
    stats,
    keepAwake,
    recent: new RecentFolders(paths.recentFoldersFile),
    version: VERSION,
    log,
    saveConfig: (c) => saveConfig(paths, c),
    tailscaleIp: bind.tailscaleIp,
  };
  const ws = (p.ws = attachWsServer(p.servers, wsDeps));
  forwarder.use(handler);

  // Read at each run: a settings change replaces `config.settings`.
  p.pruneTimer = setInterval(
    () => registry.pruneEnded(config.settings.retentionHours),
    PRUNE_INTERVAL_MS,
  ).unref();
  log.info({ addresses: bind.addresses, port, version: VERSION }, "daemon listening");
  const started: Started = { port, addresses: bind.addresses, warning: bind.warning };
  if (config.bind === "tailscale" && bind.tailscaleIp === undefined) {
    p.rebind = listenWhenTailscaleAppears({
      tailscale,
      port,
      create,
      log,
      onListening: (server, address) => {
        p.servers.push(server);
        server.on("error", (err) => log.error({ err }, "http server error"));
        ws.addServer(server);
        wsDeps.tailscaleIp = address;
        started.addresses = [address, ...started.addresses];
        started.warning = undefined;
        print(`listening on ${address}:${port} too (Tailscale)`);
      },
    });
  }
  return started;
}

/**
 * Starts the daemon for a config dir: takes its lock, listens on the configured addresses, and
 * serves the loopback HTTP relays and the WebSocket API until `stop()`. A failed start undoes
 * whatever it had started (the lock included) and rethrows.
 */
export async function startDaemon(opts: DaemonOptions = {}): Promise<Daemon> {
  const startedAt = Date.now();
  const paths = afkPaths(opts.configDir ?? defaultConfigDir());
  const verbose = opts.verbose ?? false;
  // First, so that loading the config can log.
  const log = createLogger(paths.logDir, { verbose, stdout: verbose });
  const p: Parts = { log, servers: [] };
  let started: Started;
  try {
    started = await compose(p, paths, opts, startedAt);
  } catch (err) {
    log.error({ err }, "daemon failed to start");
    await teardown(p);
    await closeLogger(log);
    throw err;
  }

  let stopping: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    await teardown(p);
    log.info("daemon stopped");
    await closeLogger(log);
  };
  // The same object compose returned, which a later Tailscale address updates.
  return Object.assign(started, { log, stop: () => (stopping ??= stop()) });
}
