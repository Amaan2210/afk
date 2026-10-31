import { vi } from "vitest";
import WebSocket, { type ClientOptions } from "ws";
import { parseServerMessage, type ServerMessage } from "../../src/protocol/index.js";

export type Frame<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;
/** The one reply a request with an id gets. */
export type Reply = Frame<"ack"> | Frame<"error">;

const WAIT = { timeout: 2000, interval: 5 };

/**
 * A real `ws` client that records every frame the daemon sends, each validated against the
 * protocol schema. Frames that fail validation are kept in `invalid`; a test should end with none.
 */
export class TestClient {
  readonly frames: ServerMessage[] = [];
  readonly invalid: unknown[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private nextId = 1;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const raw: unknown = JSON.parse(String(data));
      try {
        this.frames.push(parseServerMessage(raw));
      } catch {
        this.invalid.push(raw);
      }
    });
    // Errors after the handshake (a reset socket) surface as "close"; nothing to do here.
    ws.on("error", () => undefined);
    this.closed = new Promise((resolve) =>
      ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
    );
  }

  /** Connects; rejects with the handshake error (e.g. "Unexpected server response: 404"). */
  static open(url: string, opts?: ClientOptions): Promise<TestClient> {
    const client = new TestClient(new WebSocket(url, opts));
    return new Promise((resolve, reject) => {
      client.ws.once("open", () => resolve(client));
      client.ws.once("error", reject);
    });
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Every received frame of `type`, in order. */
  of<T extends ServerMessage["type"]>(type: T): Frame<T>[] {
    return this.frames.filter((f): f is Frame<T> => f.type === type);
  }

  types(): string[] {
    return this.frames.map((f) => f.type);
  }

  /** The first received frame of `type` matching `pred`, waiting for it if need be. */
  next<T extends ServerMessage["type"]>(
    type: T,
    pred: (f: Frame<T>) => boolean = () => true,
  ): Promise<Frame<T>> {
    return vi.waitFor(() => {
      const found = this.of(type).find(pred);
      if (found === undefined) throw new Error(`no ${type} frame yet`);
      return found;
    }, WAIT);
  }

  /** Every ack or error received for request `id`: a request should get exactly one. */
  replies(id: string): Reply[] {
    return this.frames.filter(
      (f): f is Reply => (f.type === "ack" || f.type === "error") && f.id === id,
    );
  }

  /** Sends `msg` with a fresh id and waits for the ack or error carrying it. */
  async request(msg: Record<string, unknown>): Promise<Reply> {
    const id = `r${this.nextId++}`;
    this.send({ ...msg, id });
    return vi.waitFor(() => {
      const reply = this.frames.find(
        (f): f is Reply => (f.type === "ack" || f.type === "error") && f.id === id,
      );
      if (reply === undefined) throw new Error(`no reply to ${id} yet`);
      return reply;
    }, WAIT);
  }

  /**
   * Round-trips a request the daemon answers at once: frames it sent before the reply have all
   * arrived when this resolves, so a "nothing else came" check after it is fair.
   */
  async sync(): Promise<void> {
    const id = `sync${this.nextId++}`;
    this.send({ type: "daemon.settings.get", id });
    await this.next("daemon.settings", (f) => f.id === id);
  }

  /** Authenticates and waits for the whole greeting (it ends with daemon.settings). */
  async auth(token: string): Promise<void> {
    this.send({ type: "auth", token, protocol: 1, client: { kind: "cli", name: "test" } });
    await this.next("daemon.settings");
  }

  terminate(): void {
    this.ws.terminate();
  }
}
