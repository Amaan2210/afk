import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { AttachClient, AttachIo } from "../../src/cli/attach.js";
import { DaemonNotRunningError, type Frame } from "../../src/cli/client.js";
import type { RunDeps } from "../../src/cli/run.js";
import { afkPaths } from "../../src/daemon/paths.js";
import type { Session } from "../../src/protocol/index.js";

type Msg = Record<string, unknown>;

/** What the fake daemon does with one request: frames it pushes first, then the ack or error. */
export interface Reply {
  frames?: Frame[];
  ack?: Msg;
  error?: Error;
}

export function session(over: Partial<Session> = {}): Session {
  return {
    id: "s_1",
    name: "proj",
    cwd: "C:\\proj",
    kind: "shell",
    state: "idle",
    createdAt: "2026-11-01T00:00:00.000Z",
    lastActivityAt: "2026-11-01T00:00:00.000Z",
    subagentsRunning: 0,
    ...over,
  };
}

export function b64(text: string | Buffer): string {
  return Buffer.from(text).toString("base64");
}

/**
 * A daemon client double. It records every message sent, and answers requests through
 * `onRequest`. The frames a reply carries are pushed synchronously inside `request()`, before its
 * promise settles, as the real daemon may do. For example, `session.updated` arrives before the
 * `session.create` ack, and `pty.snapshot` arrives before the caller's `await` resumes.
 */
export class FakeClient implements AttachClient {
  readonly sent: Msg[] = [];
  sessionList: Session[] = [];
  onRequest: (msg: Msg) => Reply = () => ({});
  private readonly listeners = new Map<string, Set<(m: Frame) => void>>();
  private readonly closeListeners = new Set<() => void>();

  async sessions(): Promise<Session[]> {
    return this.sessionList;
  }

  async request<T = Msg>(msg: object): Promise<T> {
    const m = msg as Msg;
    this.sent.push(m);
    const reply = this.onRequest(m);
    for (const frame of reply.frames ?? []) this.push(frame);
    if (reply.error !== undefined) throw reply.error;
    return { type: "ack", ...reply.ack } as T;
  }

  send(msg: object): void {
    this.sent.push(msg as Msg);
  }

  on(type: string, cb: (m: Frame) => void): () => void {
    const set = this.listeners.get(type) ?? new Set<(m: Frame) => void>();
    set.add(cb);
    this.listeners.set(type, set);
    return () => void set.delete(cb);
  }

  onClose(cb: () => void): () => void {
    this.closeListeners.add(cb);
    return () => void this.closeListeners.delete(cb);
  }

  /** Delivers a frame from the daemon. */
  push(frame: Frame): void {
    for (const cb of [...(this.listeners.get(frame.type) ?? [])]) cb(frame);
  }

  /** The socket closes under the client. */
  dropConnection(): void {
    for (const cb of [...this.closeListeners]) cb();
  }

  /** Listeners still registered, frames and close together. */
  listening(): number {
    let n = this.closeListeners.size;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  ofType(type: string): Msg[] {
    return this.sent.filter((m) => m.type === type);
  }

  /** Answers `session.create` with `created` and `pty.subscribe` with a snapshot of `screen`. */
  actLikeDaemon(created: Session = session(), screen = ""): void {
    this.onRequest = (msg) => {
      if (msg.type === "session.create") {
        const s = { ...created, cwd: String(msg.cwd), kind: msg.kind as Session["kind"] };
        return { frames: [{ type: "session.updated", session: s }], ack: { sessionId: s.id } };
      }
      if (msg.type === "pty.subscribe") {
        const { sessionId, cols, rows } = msg;
        return { frames: [{ type: "pty.snapshot", sessionId, cols, rows, data: b64(screen) }] };
      }
      return {};
    };
  }
}

export interface FakeTerminal {
  io: AttachIo;
  stdin: EventEmitter & {
    isTTY: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  };
  stdout: EventEmitter & { columns: number; rows: number };
  /** Everything written to stdout, as raw bytes. */
  bytes(): Buffer;
  text(): string;
  /** Keystrokes arriving on stdin. */
  type(keys: string | Buffer | number[]): void;
  /** The window changes size. */
  resize(columns: number, rows: number): void;
}

export function fakeTerminal(o: { isTTY?: boolean; columns?: number; rows?: number } = {}) {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: o.isTTY ?? true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  });
  const chunks: Buffer[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    columns: o.columns ?? 100,
    rows: o.rows ?? 40,
    write: (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
      return true;
    },
  });
  const term: FakeTerminal = {
    io: { stdin, stdout } as unknown as AttachIo,
    stdin,
    stdout,
    bytes: () => Buffer.concat(chunks),
    text: () => Buffer.concat(chunks).toString("utf8"),
    type: (keys) => {
      const bytes = typeof keys === "string" ? Buffer.from(keys, "utf8") : Buffer.from(keys);
      stdin.emit("data", bytes);
    },
    resize: (columns, rows) => {
      stdout.columns = columns;
      stdout.rows = rows;
      stdout.emit("resize");
    },
  };
  return term;
}

/** RunDeps for a machine where no daemon is running; records what the command reports. */
export function noDaemon() {
  let err = "";
  const deps: RunDeps = {
    paths: afkPaths("/cfg"),
    loadPort: vi.fn(async () => 2350),
    connect: vi.fn(async () => {
      throw new DaemonNotRunningError("ECONNREFUSED");
    }),
    stdout: { write: () => undefined },
    stderr: { write: (s) => (err += s) },
    setExitCode: vi.fn(),
  };
  return { deps, err: () => err };
}
