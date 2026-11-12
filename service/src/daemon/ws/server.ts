import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { DaemonConfig } from "../config.js";
import { DeviceStore } from "../devices.js";
import { AnsweredPendings } from "./answered.js";
import { wireBroadcasts } from "./broadcasts.js";
import { ClientConn } from "./client-conn.js";
import { CLOSE_GOING_AWAY, type WsContext, type WsDeps } from "./context.js";

export type { WsDeps } from "./context.js";

const WS_PATH = "/ws";
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_AUTH_TIMEOUT_MS = 5000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_ANSWER_CHUNK_DELAY_MS = 50;
const DEFAULT_CLOSE_GRACE_MS = 1000;

export interface WsServer {
  /**
   * Serves the API on one more http server, such as one on an address that appeared later.
   * Throws once `close()` has been called.
   */
  addServer(server: Server): void;
  /** Closes every client (1001), stops listening for upgrades and resolves when all are gone. */
  close(): Promise<void>;
  /** Authenticated clients. */
  clientCount(): number;
}

/** Runs `save` calls one after another: concurrent writes of one file would race. */
function serialized(save: (c: DaemonConfig) => Promise<void>): (c: DaemonConfig) => Promise<void> {
  let last: Promise<void> = Promise.resolve();
  return (c) => {
    const run = last.then(() => save(c));
    last = run.catch(() => undefined);
    return run;
  };
}

function pathOf(req: IncomingMessage): string | undefined {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

/** Answers an upgrade on any other path with a 404 and drops the socket. */
function refuse(socket: Duplex): void {
  socket.on("error", () => socket.destroy());
  socket.once("finish", () => socket.destroy());
  socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}

/**
 * The authenticated WebSocket API at `/ws` on `servers` (see protocol/protocol.md): a handshake per
 * socket, requests handled by `handlers.ts`, and the daemon's events broadcast to the clients
 * subscribed to them. With one http server per bound address, all of them share one set of
 * clients, devices and config saves, so a change made over one address reaches the others.
 */
export function attachWsServer(servers: Server | Server[], deps: WsDeps): WsServer {
  // A copy: `addServer` adds to it, and `close` unsubscribes from every one.
  const httpServers = Array.isArray(servers) ? [...servers] : [servers];
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const conns = new Set<ClientConn>();
  const save = serialized(deps.saveConfig);
  let nextId = 1;

  const ctx: WsContext = {
    deps,
    devices: new DeviceStore(deps.config, save),
    answered: new AnsweredPendings(deps.registry),
    authTimeoutMs: deps.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
    answerChunkDelayMs: deps.answerChunkDelayMs ?? DEFAULT_ANSWER_CHUNK_DELAY_MS,
    save: () => save(deps.config),
    clients: () => [...conns].filter((c) => c.authenticated),
    broadcast(msg, filter) {
      const text = JSON.stringify(msg);
      for (const c of conns) if (c.authenticated && (filter?.(c) ?? true)) c.sendText(text);
    },
    remove(conn) {
      conns.delete(conn);
      deps.onClientGone?.();
    },
  };

  wss.on("connection", (ws) => conns.add(new ClientConn(`c${nextId++}`, ws, ctx)));
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(req) !== WS_PATH) return refuse(socket);
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  };
  for (const server of httpServers) server.on("upgrade", onUpgrade);
  const unwire = wireBroadcasts(ctx);
  const heartbeat = setInterval(() => {
    for (const c of conns) c.heartbeat();
  }, deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  heartbeat.unref();

  let closed = false;
  return {
    addServer(server) {
      if (closed) throw new Error("The WebSocket API is closed; it takes no more servers.");
      httpServers.push(server);
      server.on("upgrade", onUpgrade);
    },
    clientCount: () => ctx.clients().length,
    async close() {
      closed = true;
      clearInterval(heartbeat);
      for (const server of httpServers) server.off("upgrade", onUpgrade);
      unwire();
      ctx.answered.dispose();
      for (const c of conns) c.close(CLOSE_GOING_AWAY, "daemon shutting down");
      const cutOff = setTimeout(() => {
        for (const c of conns) c.terminate();
      }, deps.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS);
      cutOff.unref();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      clearTimeout(cutOff);
    },
  };
}
