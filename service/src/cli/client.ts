import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { readLocalToken } from "../daemon/config.js";
import type { AfkPaths } from "../daemon/paths.js";
import { PROTOCOL_VERSION, type ServerMessage, type Session } from "../protocol/index.js";

const HELLO_TIMEOUT_MS = 5000;
const CLOSED = "The daemon closed the connection.";

/** One JSON frame from the daemon. */
export type Frame = { type: string; id?: string } & Record<string, unknown>;
export type Hello = Extract<ServerMessage, { type: "hello" }>;

/** No daemon is listening (or it never ran, so there is no local token). */
export class DaemonNotRunningError extends Error {
  constructor(detail: string) {
    super(`The AFK daemon is not running (${detail}).`);
    this.name = "DaemonNotRunningError";
  }
}

export const NOT_SET_UP =
  "AFK has not run on this machine yet. It starts with your first session (`afk claude`, `afk codex` or `afk shell`) or with `afk pair`.";

/** No config or local token yet: the daemon has never run for this user. */
export class DaemonNotSetUpError extends Error {
  constructor() {
    super(NOT_SET_UP);
    this.name = "DaemonNotSetUpError";
  }
}

/** The daemon answered with an `error` frame. */
export class DaemonError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DaemonError";
  }
}

interface Waiting {
  resolve: (frame: Frame) => void;
  reject: (err: Error) => void;
}

/** What the commands use of a client; tests hand them a fake. */
export interface CommandClient {
  readonly hello: Pick<Hello, "daemon">;
  sessions(): Promise<Session[]>;
  request<T = Record<string, unknown>>(msg: object): Promise<T>;
}

/** A WebSocket connection to the daemon, authenticated with the local token. */
export class DaemonClient implements CommandClient {
  private helloFrame: Hello | undefined;
  private readonly waiting = new Map<string, Waiting>();
  private readonly listeners = new Map<string, Set<(m: Frame) => void>>();
  private readonly closeListeners = new Set<() => void>();
  private gotSnapshot: (sessions: Session[]) => void = () => undefined;
  private noSnapshot: (err: Error) => void = () => undefined;
  private readonly firstSnapshot = new Promise<Session[]>((resolve, reject) => {
    this.gotSnapshot = resolve;
    this.noSnapshot = reject;
  });
  private closed = false;

  private constructor(private readonly ws: WebSocket) {
    // Whoever calls sessions() sees a rejection; one that never asks must not crash the process.
    this.firstSnapshot.catch(() => undefined);
  }

  /** Resolves once the daemon has said hello; rejects if it does not within 5 s. */
  static async connectLocal(
    paths: AfkPaths,
    port: number,
    helloTimeoutMs: number = HELLO_TIMEOUT_MS,
  ): Promise<DaemonClient> {
    let token: string;
    try {
      token = await readLocalToken(paths);
    } catch (err) {
      // Never minted here: the daemon writes the token when it first starts.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new DaemonNotSetUpError();
      throw err;
    }
    const client = new DaemonClient(new WebSocket(`ws://127.0.0.1:${port}/ws`));
    await client.handshake(token, helloTimeoutMs);
    return client;
  }

  private handshake(token: string, timeoutMs: number): Promise<void> {
    const { ws } = this;
    return new Promise((resolve, reject) => {
      const fail = (err: Error): void => {
        clearTimeout(timer);
        this.close();
        reject(err);
      };
      const timer = setTimeout(
        () => fail(new Error("The daemon did not answer the handshake.")),
        timeoutMs,
      );
      const auth = {
        type: "auth",
        token,
        protocol: PROTOCOL_VERSION,
        client: { kind: "cli", name: "afk" },
      };
      ws.on("open", () => ws.send(JSON.stringify(auth)));
      ws.on("error", (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        fail(code === "ECONNREFUSED" ? new DaemonNotRunningError(code) : err);
      });
      ws.on("close", () => {
        this.markClosed();
        fail(new Error(CLOSED));
      });
      ws.on("message", (data) => {
        let frame: Frame;
        try {
          frame = JSON.parse(String(data)) as Frame;
        } catch {
          // Before hello the daemon is not speaking our protocol; after, one bad frame is skipped.
          if (this.helloFrame === undefined) fail(new Error("The daemon sent a malformed frame."));
          return;
        }
        if (this.helloFrame !== undefined) return this.dispatch(frame);
        if (frame.type === "hello") {
          this.helloFrame = frame as unknown as Hello;
          clearTimeout(timer);
          resolve();
        } else if (frame.type === "error") {
          fail(new DaemonError(String(frame.code), String(frame.message)));
        }
      });
    });
  }

  private dispatch(frame: Frame): void {
    if (frame.type === "sessions.snapshot") this.gotSnapshot(frame.sessions as Session[]);
    if (frame.type === "error" && frame.id === undefined) {
      // The daemon could not tell which request failed: none of them can be answered now.
      const err = new DaemonError(String(frame.code), String(frame.message));
      for (const waiting of this.waiting.values()) waiting.reject(err);
      this.waiting.clear();
    }
    if ((frame.type === "ack" || frame.type === "error") && frame.id !== undefined) {
      const waiting = this.waiting.get(frame.id);
      if (waiting !== undefined) {
        this.waiting.delete(frame.id);
        if (frame.type === "ack") waiting.resolve(frame);
        else waiting.reject(new DaemonError(String(frame.code), String(frame.message)));
        return;
      }
    }
    for (const cb of this.listeners.get(frame.type) ?? []) cb(frame);
  }

  /** Runs once, whether the daemon closed the socket or `close()` did. */
  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.waiting.values()) waiting.reject(new Error(CLOSED));
    this.waiting.clear();
    this.noSnapshot(new Error(CLOSED));
    for (const cb of [...this.closeListeners]) cb();
  }

  get hello(): Hello {
    if (this.helloFrame === undefined) throw new Error("Not connected.");
    return this.helloFrame;
  }

  /** The sessions the daemon listed in its greeting. */
  sessions(): Promise<Session[]> {
    return this.firstSnapshot;
  }

  /** Sends `msg` with a fresh id; resolves with the ack, rejects with a `DaemonError` on error. */
  request<T = Record<string, unknown>>(msg: object): Promise<T> {
    if (this.closed) return Promise.reject(new Error(CLOSED));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: (f) => resolve(f as T), reject });
      try {
        this.send({ ...msg, id });
      } catch (err) {
        this.waiting.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Calls `cb` for every pushed frame of `type`; the returned function stops it. */
  on(type: string, cb: (m: Frame) => void): () => void {
    const set = this.listeners.get(type) ?? new Set<(m: Frame) => void>();
    set.add(cb);
    this.listeners.set(type, set);
    return () => void set.delete(cb);
  }

  /** Calls `cb` once when the connection closes; the returned function stops it. */
  onClose(cb: () => void): () => void {
    this.closeListeners.add(cb);
    return () => void this.closeListeners.delete(cb);
  }

  close(): void {
    this.ws.terminate();
    this.markClosed();
  }
}
