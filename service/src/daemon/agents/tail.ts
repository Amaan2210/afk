import { EventEmitter } from "node:events";
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";

const DEFAULT_POLL_MS = 250;
/** Most bytes read per `readSync`, so a large backlog is not loaded in one allocation. */
const READ_CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

export interface JsonlTailerOptions {
  /** How often to look for appended bytes. */
  pollMs?: number;
  /** Emit the lines already in the file (default), or only those appended after `start()`. */
  fromStart?: boolean;
  /**
   * Called with an exception a listener threw, after the tailer has carried on (default: throw it
   * again on the next tick, as an uncaught exception).
   */
  rethrow?: (err: unknown) => void;
}

function throwOnNextTick(err: unknown): void {
  process.nextTick(() => {
    throw err;
  });
}

export interface JsonlTailerEvents {
  /** A complete line that parsed as JSON. `lineNo` is 1-based from where reading began. */
  line: [obj: unknown, lineNo: number];
  /** The file shrank (truncated or replaced); reading restarts from its first byte. */
  reset: [];
  /**
   * Reading has reached the end of the file: every line emitted so far was already there when
   * reading began, and every later line is new. Emitted once after `start()`, at the end of the
   * first poll that read the file to its end (or found no file), and once more after each reset.
   */
  caughtUp: [];
  /** An I/O failure other than the file not existing. Emitted only when someone listens. */
  error: [err: Error];
}

type Line = [obj: unknown, lineNo: number];

/**
 * Follows a JSONL file that another process appends to and emits each complete line as parsed
 * JSON. It polls instead of using `fs.watch`, which misses appends on Windows, and reads only the
 * bytes appended since the last poll. A partial trailing line, including a UTF-8 sequence split
 * across two writes, is carried as raw bytes until its newline arrives, so it is decoded whole.
 * Malformed lines are skipped. A missing file is retried on every poll until it appears.
 * `caughtUp` separates the lines replayed from the file from those appended afterwards.
 *
 * A listener that throws does not stop the tailer: the exception is re-thrown on the next tick,
 * where it surfaces as an uncaught exception, and the remaining lines are still delivered.
 */
export class JsonlTailer extends EventEmitter<JsonlTailerEvents> {
  private readonly pollMs: number;
  private readonly fromStart: boolean;
  private readonly rethrow: (err: unknown) => void;
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private offset = 0;
  private carry = Buffer.alloc(0);
  private lineNo = 0;
  private caught = false;
  private reading = false;

  constructor(
    readonly path: string,
    opts: JsonlTailerOptions = {},
  ) {
    super();
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.fromStart = opts.fromStart ?? true;
    this.rethrow = opts.rethrow ?? throwOnNextTick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.fromStart) this.offset = sizeOf(this.path) ?? 0;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Reads what has been appended now rather than at the next poll, emitting before it returns.
   * The poll schedule is unchanged. Does nothing while stopped, or when called from a listener
   * during a read (the read in progress delivers those lines).
   */
  drain(): void {
    if (this.running) this.poll();
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.poll();
      if (this.running) this.schedule(this.pollMs);
    }, delayMs);
  }

  /** Reads what was appended since the last poll. Synchronous, and never nested in another. */
  private poll(): void {
    if (this.reading) return;
    this.reading = true;
    try {
      this.read();
    } finally {
      this.reading = false;
    }
  }

  private read(): void {
    let fd: number;
    try {
      fd = openSync(this.path, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") this.catchUp();
      else this.fail(err);
      return;
    }
    try {
      const size = this.io(() => fstatSync(fd).size);
      if (size === undefined) return;
      if (size < this.offset) this.restart();
      while (this.running && this.offset < size) {
        const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, size - this.offset));
        const read = this.io(() => readSync(fd, chunk, 0, chunk.length, this.offset));
        if (!read) return; // failed, or the file shrank under us: the next poll sorts it out
        this.offset += read;
        for (const [obj, lineNo] of this.split(chunk.subarray(0, read))) {
          if (!this.running) return;
          this.deliver(() => this.emit("line", obj, lineNo));
        }
      }
      if (this.running) this.catchUp();
    } finally {
      this.io(() => closeSync(fd));
    }
  }

  private restart(): void {
    this.offset = 0;
    this.carry = Buffer.alloc(0);
    this.lineNo = 0;
    this.caught = false;
    this.deliver(() => this.emit("reset"));
  }

  /** Emits `caughtUp` the first time reading reaches the end since `start()` or a reset. */
  private catchUp(): void {
    if (this.caught) return;
    this.caught = true;
    this.deliver(() => this.emit("caughtUp"));
  }

  /**
   * Parses every complete line in `carry + chunk` and keeps the incomplete tail as bytes. Emits
   * nothing, so the carry is settled before any listener runs.
   */
  private split(chunk: Buffer): Line[] {
    const data = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    const lines: Line[] = [];
    let start = 0;
    for (let nl = data.indexOf(NEWLINE); nl !== -1; nl = data.indexOf(NEWLINE, start)) {
      const text = data.toString("utf8", start, nl);
      start = nl + 1;
      this.lineNo++;
      const parsed = parseJson(text);
      if (parsed.ok) lines.push([parsed.value, this.lineNo]);
    }
    this.carry = Buffer.from(data.subarray(start));
    return lines;
  }

  /** Runs one file-system call, reporting a failure as an I/O error. */
  private io<T>(call: () => T): T | undefined {
    try {
      return call();
    } catch (err) {
      this.fail(err);
      return undefined;
    }
  }

  /** Emits to listeners. A listener's exception is its own bug, not the tailer's: re-throw it. */
  private deliver(emit: () => void): void {
    try {
      emit();
    } catch (err) {
      this.rethrow(err);
    }
  }

  private fail(err: unknown): void {
    if (this.listenerCount("error") === 0) return;
    this.deliver(() => this.emit("error", err instanceof Error ? err : new Error(String(err))));
  }
}

function sizeOf(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
