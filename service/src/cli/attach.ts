import type { Session } from "../protocol/index.js";
import type { Frame } from "./client.js";
import { Win32InputFilter } from "./conpty-filter.js";
import { CliError } from "./run.js";
import { SessionWatch } from "./session-watch.js";
import { TerminalReset } from "./terminal-reset.js";

/** How an attach ended: the session ended, or the daemon went away. */
export type AttachOutcome = "ended" | "lost";

/** What attach uses of a daemon client; tests hand it a fake. */
export interface AttachClient {
  sessions(): Promise<Session[]>;
  request<T = Record<string, unknown>>(msg: object): Promise<T>;
  send(msg: object): void;
  on(type: string, cb: (m: Frame) => void): () => void;
  onClose(cb: () => void): () => void;
}

/** The parts of `process.stdin` attach uses. */
export interface TtyIn {
  readonly isTTY?: boolean;
  setRawMode(mode: boolean): unknown;
  on(event: "data", cb: (chunk: Buffer) => void): unknown;
  off(event: "data", cb: (chunk: Buffer) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** The parts of `process.stdout` attach uses. */
export interface TtyOut {
  readonly columns?: number;
  readonly rows?: number;
  write(chunk: Uint8Array | string): unknown;
  on(event: "resize", cb: () => void): unknown;
  off(event: "resize", cb: () => void): unknown;
}

export interface AttachIo {
  stdin: TtyIn;
  stdout: TtyOut;
}

type Size = { cols: number; rows: number };

/** Home the cursor and clear the window: the pty's screen is drawn from the top-left corner. */
const CLEAR_SCREEN = "\x1b[H\x1b[2J";
/**
 * Starts the closing message on a fresh line and clears what the session drew below the cursor,
 * such as the footer under an agent's input box, so no leftover follows the message.
 */
const MESSAGE_LINE = "\r\n\x1b[J";
const FALLBACK_SIZE: Size = { cols: 80, rows: 24 };

/** Attaching puts stdin in raw mode, which only a terminal has. */
export function requireTty(stdin: TtyIn): void {
  if (stdin.isTTY !== true) {
    throw new CliError("Attaching needs an interactive terminal, and stdin is not one.");
  }
}

/** A command's exit code after attaching: 1 if the daemon went away, else the session's. */
export function exitCodeFor(outcome: AttachOutcome, session: Session | undefined): number {
  if (outcome === "lost") return 1;
  return session?.exitCode ?? 0;
}

/**
 * Connects this terminal to a session's pty until the session ends or the connection drops.
 * There is no way to leave a session running without a window: closing this one ends the session
 * (the daemon sees the connection go), unless another window still shows it. The terminal is
 * restored on every path and on error. `watch` is the caller's view of the sessions, when it needs one that started earlier.
 */
export async function attach(
  client: AttachClient,
  sessionId: string,
  io: AttachIo,
  watch?: SessionWatch,
): Promise<AttachOutcome> {
  requireTty(io.stdin);
  if (watch !== undefined) return new Attachment(client, sessionId, io, watch).run();
  const own = new SessionWatch(client);
  try {
    own.seed(await client.sessions());
    return await new Attachment(client, sessionId, io, own).run();
  } finally {
    own.stop();
  }
}

/** One attach, from taking the terminal to handing it back. */
class Attachment {
  private readonly reset = new TerminalReset();
  private readonly filter = new Win32InputFilter();
  private readonly stops: (() => void)[] = [];
  private screenShown = false;
  private ptySize: Size | undefined;
  private settled = false;
  private resolve: (outcome: AttachOutcome) => void = () => undefined;
  private reject: (err: Error) => void = () => undefined;

  constructor(
    private readonly client: AttachClient,
    private readonly sessionId: string,
    private readonly io: AttachIo,
    private readonly watch: SessionWatch,
  ) {}

  run(): Promise<AttachOutcome> {
    const done = new Promise<AttachOutcome>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    const { client, io, sessionId } = this;
    // Every listener is in place before the subscribe: its snapshot can arrive before it resolves.
    this.stops.push(
      client.on("pty.snapshot", (m) => this.mine(m) && this.showSnapshot(m)),
      client.on("pty.data", (m) => this.mine(m) && this.showOutput(m)),
      client.on("pty.resized", (m) => this.mine(m) && this.sizedElsewhere(m)),
      this.watch.onChange((id) => id === sessionId && this.checkEnded()),
    );
    try {
      io.stdin.setRawMode(true);
      io.stdin.on("data", this.onKeys);
      io.stdin.resume();
      io.stdout.on("resize", this.onResize);
      this.stops.push(client.onClose(() => this.finish("lost")));
      client
        .request({ type: "pty.subscribe", sessionId, ...this.localSize() })
        .catch((err: unknown) => this.fail(err));
    } catch (err) {
      this.fail(err);
    }
    return done;
  }

  private mine(m: Frame): boolean {
    return m.sessionId === this.sessionId;
  }

  private showSnapshot(m: Frame): void {
    this.ptySize = { cols: Number(m.cols), rows: Number(m.rows) };
    this.write(Buffer.concat([Buffer.from(CLEAR_SCREEN), Buffer.from(String(m.data), "base64")]));
    this.screenShown = true;
    // A session that had already ended sends its last screen and nothing after it.
    this.checkEnded();
  }

  private showOutput(m: Frame): void {
    // Output from before the snapshot is part of it.
    if (this.screenShown) this.write(Buffer.from(String(m.data), "base64"));
  }

  /** Another client resized the pty. Answering with this window's size would ping-pong. */
  private sizedElsewhere(m: Frame): void {
    this.ptySize = { cols: Number(m.cols), rows: Number(m.rows) };
  }

  private readonly onKeys = (chunk: Buffer): void => {
    if (chunk.length === 0) return;
    // The pty follows the size of the window that typed last.
    if (this.ptySize !== undefined && !sameSize(this.ptySize, this.localSize())) this.sendSize();
    const data = chunk.toString("base64");
    this.trySend({ type: "pty.input", sessionId: this.sessionId, data });
  };

  private readonly onResize = (): void => this.sendSize();

  private sendSize(): void {
    const size = this.localSize();
    this.ptySize = size;
    this.trySend({ type: "pty.resize", sessionId: this.sessionId, ...size });
  }

  private checkEnded(): void {
    if (!this.screenShown) return;
    const ended = this.watch.get(this.sessionId)?.state === "ended";
    if (ended || this.watch.isRemoved(this.sessionId)) this.finish("ended");
  }

  private finish(outcome: AttachOutcome): void {
    if (this.settled) return;
    this.settled = true;
    this.restore();
    this.io.stdout.write(`${MESSAGE_LINE}${this.message(outcome)}\r\n`);
    this.resolve(outcome);
  }

  private fail(err: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.restore();
    this.reject(err instanceof Error ? err : new Error(String(err)));
  }

  private message(outcome: AttachOutcome): string {
    const session = this.watch.get(this.sessionId);
    if (outcome === "lost") return "[afk] lost connection to the daemon";
    // With no exit code known the command exits 0, and the message says so.
    return `[afk] session ended (exit ${session?.exitCode ?? 0})`;
  }

  /** Hands the terminal back: listeners off, cooked mode, stdin paused, modes reset. */
  private restore(): void {
    for (const stop of this.stops.splice(0)) stop();
    const { stdin, stdout } = this.io;
    stdin.off("data", this.onKeys);
    stdout.off("resize", this.onResize);
    try {
      stdin.setRawMode(false);
    } catch {
      // The terminal is already gone (its window closed); there is nothing to restore.
    }
    stdin.pause();
    this.trySend({ type: "pty.unsubscribe", sessionId: this.sessionId });
    stdout.write(this.reset.sequence());
  }

  /** Writes the session's bytes as they are, less the request `Win32InputFilter` drops. */
  private write(bytes: Buffer): void {
    const shown = this.filter.filter(bytes);
    if (shown.length === 0) return;
    this.reset.observe(shown);
    this.io.stdout.write(shown);
  }

  /** A send on a closing socket is dropped; the close itself ends the attach. */
  private trySend(msg: object): void {
    try {
      this.client.send(msg);
    } catch {
      // See above.
    }
  }

  private localSize(): Size {
    const { columns, rows } = this.io.stdout;
    if (!columns || !rows) return FALLBACK_SIZE;
    return { cols: columns, rows };
  }
}

function sameSize(a: Size, b: Size): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}
