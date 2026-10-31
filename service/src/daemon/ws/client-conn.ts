import os from "node:os";
import WebSocket, { type RawData } from "ws";
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "../../protocol/index.js";
import { isRecord } from "../../util/is-record.js";
import { CLOSE_PROTOCOL_MISMATCH, CLOSE_UNAUTHORIZED, type WsContext } from "./context.js";
import { describeInvalid, toWireError, WsError } from "./errors.js";
import { dispatch } from "./handlers.js";

type State = "awaiting_auth" | "ready" | "closed";
type Device = { id: string; name: string };

const LOCAL_DEVICE: Device = { id: "local", name: "cli" };

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/**
 * One client socket: its handshake, its subscriptions and the frames it is sent. Each frame is
 * handled on its own; a request is answered exactly once, by its handler or with the error the
 * handler threw. Nothing is sent to a socket that is not open, and no broadcast reaches a socket
 * before it has authenticated.
 */
export class ClientConn {
  /** Who the socket authenticated as. */
  device: Device | undefined;
  /** Sessions whose terminal output this client receives. */
  readonly pty = new Set<string>();
  /** Chat threads this client receives, by session. */
  private readonly chat = new Map<string, Set<string>>();
  private state: State = "awaiting_auth";
  private local = false;
  private alive = true;
  private readonly authTimer: NodeJS.Timeout;

  constructor(
    readonly id: string,
    private readonly ws: WebSocket,
    private readonly ctx: WsContext,
  ) {
    const timeout = () => this.reject("unauthorized", "no auth frame in time", CLOSE_UNAUTHORIZED);
    this.authTimer = setTimeout(timeout, ctx.authTimeoutMs);
    this.authTimer.unref();
    ws.on("message", (data) => this.onFrame(data));
    ws.on("pong", () => (this.alive = true));
    ws.on("error", (err) => this.ctx.deps.log.debug(this.fields(err), "ws: socket error"));
    ws.on("close", () => this.onClose());
  }

  get authenticated(): boolean {
    return this.state === "ready";
  }

  /** Authenticated with the CLI's local token, which alone may manage devices. */
  get isLocal(): boolean {
    return this.local;
  }

  send(msg: ServerMessage): void {
    this.sendText(JSON.stringify(msg));
  }

  /** Sends a serialized frame. Never throws; sends nothing on a socket that is not open. */
  sendText(text: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(text);
    } catch (err) {
      this.ctx.deps.log.warn(this.fields(err), "ws: send failed");
    }
  }

  ack(id: string, fields: Record<string, unknown> = {}): void {
    this.send({ ...fields, type: "ack", id });
  }

  sendError(code: ErrorCode, message: string, id?: string): void {
    this.send(
      id === undefined ? { type: "error", code, message } : { type: "error", id, code, message },
    );
  }

  /** Sends an error, then closes the socket: nothing more is sent to it or handled from it. */
  reject(code: ErrorCode, message: string, closeCode: number): void {
    if (this.state === "closed") return;
    this.sendError(code, message);
    this.close(closeCode, code);
  }

  close(code: number, reason: string): void {
    this.state = "closed";
    clearTimeout(this.authTimer);
    this.ws.close(code, reason);
  }

  terminate(): void {
    this.ws.terminate();
  }

  /** Drops a socket that did not answer the last ping, and pings the others. */
  heartbeat(): void {
    if (!this.alive) return this.ws.terminate();
    this.alive = false;
    try {
      this.ws.ping();
    } catch (err) {
      this.ctx.deps.log.debug(this.fields(err), "ws: ping failed");
    }
  }

  subscribeChat(sessionId: string, threadId: string): void {
    const threads = this.chat.get(sessionId) ?? new Set<string>();
    threads.add(threadId);
    this.chat.set(sessionId, threads);
  }

  unsubscribeChat(sessionId: string, threadId: string): void {
    const threads = this.chat.get(sessionId);
    threads?.delete(threadId);
    if (threads?.size === 0) this.chat.delete(sessionId);
  }

  watchesChat(sessionId: string, threadId: string): boolean {
    return this.chat.get(sessionId)?.has(threadId) ?? false;
  }

  /** Subscribed to the session's terminal or to any of its chat threads. */
  watches(sessionId: string): boolean {
    return this.pty.has(sessionId) || this.chat.has(sessionId);
  }

  /** Ends every subscription to the session. */
  forget(sessionId: string): void {
    this.pty.delete(sessionId);
    this.chat.delete(sessionId);
  }

  /** Log fields naming this client. */
  fields(err?: unknown): Record<string, unknown> {
    return { client: this.id, device: this.device?.id, ...(err === undefined ? {} : { err }) };
  }

  private onFrame(data: RawData): void {
    if (this.state === "closed") return;
    let raw: unknown;
    try {
      raw = JSON.parse(textOf(data));
    } catch {
      raw = undefined;
    }
    const id = isRecord(raw) && typeof raw.id === "string" ? raw.id : undefined;
    let msg: ClientMessage;
    try {
      msg = parseClientMessage(raw);
    } catch (err) {
      if (!this.authenticated) {
        return this.reject("unauthorized", "the first frame must be auth", CLOSE_UNAUTHORIZED);
      }
      return this.sendError("bad_request", describeInvalid(raw, err), id);
    }
    void this.run(id, () => (this.authenticated ? this.handle(msg) : this.authenticate(msg)));
  }

  /** Runs one frame's work; whatever it throws, sync or async, becomes its one error reply. */
  private async run(id: string | undefined, work: () => void | Promise<void>): Promise<void> {
    try {
      await work();
    } catch (err) {
      const { code, message } = toWireError(err);
      if (code === "internal") this.ctx.deps.log.warn(this.fields(err), "ws: request failed");
      if (this.authenticated) this.sendError(code, message, id);
      else this.reject(code, message, CLOSE_UNAUTHORIZED);
    }
  }

  private handle(msg: ClientMessage): void | Promise<void> {
    if (msg.type === "auth") throw new WsError("bad_request", "already authenticated");
    return dispatch(this, msg, this.ctx);
  }

  private authenticate(msg: ClientMessage): void {
    if (msg.type !== "auth") {
      return this.reject("unauthorized", "the first frame must be auth", CLOSE_UNAUTHORIZED);
    }
    if (msg.protocol !== PROTOCOL_VERSION) {
      const message = `the daemon speaks protocol ${PROTOCOL_VERSION}`;
      return this.reject("protocol_mismatch", message, CLOSE_PROTOCOL_MISMATCH);
    }
    const who = this.ctx.devices.authenticate(msg.token);
    if (who === undefined) return this.reject("unauthorized", "unknown token", CLOSE_UNAUTHORIZED);
    const device = who === "local" ? LOCAL_DEVICE : { id: who.id, name: who.name };
    // Built before the client counts as authenticated, so a failure leaves it unauthenticated.
    const greeting = this.greeting(device);
    clearTimeout(this.authTimer);
    this.state = "ready";
    this.local = who === "local";
    this.device = device;
    for (const frame of greeting) this.send(frame);
    if (who !== "local") {
      this.ctx.devices
        .markSeen(who.id)
        .catch((err: unknown) =>
          this.ctx.deps.log.warn(this.fields(err), "ws: lastSeenAt not saved"),
        );
    }
  }

  /** hello, sessions.snapshot, stats, daemon.settings, in that order. */
  private greeting(device: Device): ServerMessage[] {
    const { version, tailscaleIp, registry, stats, keepAwake, config } = this.ctx.deps;
    const daemon = {
      version,
      hostname: os.hostname(),
      platform: process.platform,
      ...(tailscaleIp === undefined ? {} : { tailscaleIp }),
    };
    return [
      { type: "hello", protocol: PROTOCOL_VERSION, daemon, device },
      { type: "sessions.snapshot", sessions: registry.list() },
      { type: "stats", ...stats.current(keepAwake.active) },
      { type: "daemon.settings", settings: config.settings },
    ];
  }

  private onClose(): void {
    this.state = "closed";
    clearTimeout(this.authTimer);
    this.pty.clear();
    this.chat.clear();
    this.ctx.remove(this);
  }
}
