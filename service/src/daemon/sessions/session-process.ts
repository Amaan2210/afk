import { SerializeAddon } from "@xterm/addon-serialize";
import headless, { type Terminal } from "@xterm/headless";
import { RingBuffer } from "../../util/ring-buffer.js";
import type { PtyFactory, PtyLike, PtySpawnOptions } from "./pty.js";

export interface SessionProcessOptions extends PtySpawnOptions {
  ptyFactory: PtyFactory;
  ringBufferBytes: number;
  snapshotScrollback: number;
}

/** Terminal contents a late-joining client writes into a `cols` x `rows` terminal to catch up. */
export interface PtySnapshot {
  cols: number;
  rows: number;
  data: Buffer;
}

/**
 * One session's pseudo-terminal. Every output chunk goes, as the same bytes, to a raw ring buffer,
 * to a headless xterm that serializes the screen and scrollback for late joiners, and to `onData`
 * subscribers.
 */
export class SessionProcess {
  readonly pid: number;
  private width: number;
  private height: number;
  private readonly pty: PtyLike;
  private readonly terminal: Terminal;
  private readonly serializer = new SerializeAddon();
  private readonly scrollback: number;
  private readonly ring: RingBuffer;
  /** Chunks handed to the headless terminal that it has not parsed yet (it parses on a timer). */
  private readonly unparsed: Buffer[] = [];
  private readonly dataListeners = new Set<(chunk: Buffer) => void>();
  private readonly exitListeners = new Set<(exitCode: number) => void>();
  /** Set on exit, when the headless terminal is disposed: the snapshot served from then on. */
  private lastSnapshot: PtySnapshot | undefined;

  constructor(o: SessionProcessOptions) {
    this.width = o.cols;
    this.height = o.rows;
    this.scrollback = o.snapshotScrollback;
    this.ring = new RingBuffer(o.ringBufferBytes);
    this.terminal = new headless.Terminal({
      cols: o.cols,
      rows: o.rows,
      scrollback: o.snapshotScrollback,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializer);
    this.pty = o.ptyFactory({
      exe: o.exe,
      args: o.args,
      cwd: o.cwd,
      env: o.env,
      cols: o.cols,
      rows: o.rows,
    });
    this.pid = this.pty.pid;
    this.pty.onData((chunk) => this.handleData(chunk));
    this.pty.onExit(({ exitCode }) => this.handleExit(exitCode));
  }

  get cols(): number {
    return this.width;
  }

  get rows(): number {
    return this.height;
  }

  write(bytes: Buffer): void {
    if (this.lastSnapshot) return;
    this.pty.write(bytes);
  }

  resize(cols: number, rows: number): void {
    if (this.lastSnapshot) return;
    this.pty.resize(cols, rows);
    this.terminal.resize(cols, rows);
    this.width = cols;
    this.height = rows;
  }

  /** Passed through even after exit: the pty owns its own clean-up and knows when kill is moot. */
  kill(): void {
    this.pty.kill();
  }

  /**
   * The serialized screen and up to `snapshotScrollback` lines of scrollback, followed by any
   * output the headless terminal has not parsed yet, so nothing emitted so far is missing.
   */
  snapshot(): PtySnapshot {
    if (this.lastSnapshot) return this.lastSnapshot;
    const screen = this.serializer.serialize({ scrollback: this.scrollback });
    return {
      cols: this.width,
      rows: this.height,
      data: Buffer.concat([Buffer.from(screen, "utf8"), ...this.unparsed]),
    };
  }

  onData(cb: (chunk: Buffer) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (exitCode: number) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  private handleData(chunk: Buffer): void {
    this.ring.push(chunk);
    if (!this.lastSnapshot) {
      this.unparsed.push(chunk);
      // xterm keeps the bytes of a code point split across writes and decodes it whole.
      this.terminal.write(chunk, () => this.unparsed.shift());
    }
    for (const cb of this.dataListeners) cb(chunk);
  }

  private handleExit(exitCode: number): void {
    if (this.lastSnapshot) return;
    this.lastSnapshot = this.snapshot();
    this.terminal.dispose();
    this.unparsed.length = 0;
    for (const cb of this.exitListeners) cb(exitCode);
  }
}
