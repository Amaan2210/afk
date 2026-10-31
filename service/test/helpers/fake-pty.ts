import type { PtyFactory, PtyLike, PtySpawnOptions } from "../../src/daemon/sessions/pty.js";

/** In-memory `PtyLike`: records what the session does to it and lets a test drive its output. */
export class FakePty implements PtyLike {
  readonly written: Buffer[] = [];
  size: { cols: number; rows: number };
  killed = false;
  private readonly dataListeners: ((data: Buffer) => void)[] = [];
  private readonly exitListeners: ((e: { exitCode: number }) => void)[] = [];

  constructor(
    readonly lastSpawn: PtySpawnOptions,
    readonly pid: number,
  ) {
    this.size = { cols: lastSpawn.cols, rows: lastSpawn.rows };
  }

  write(data: string | Buffer): void {
    this.written.push(Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"));
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
  }

  kill(): void {
    this.killed = true;
  }

  onData(cb: (data: Buffer) => void): void {
    this.dataListeners.push(cb);
  }

  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitListeners.push(cb);
  }

  emitData(data: string | Buffer): void {
    const chunk = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    for (const cb of this.dataListeners) cb(chunk);
  }

  emitExit(code: number): void {
    for (const cb of this.exitListeners) cb({ exitCode: code });
  }
}

/** A `PtyFactory` that hands out `FakePty`s; `last` is the most recently spawned one. */
export function createFakePty(): { factory: PtyFactory; readonly last: FakePty } {
  let last: FakePty | undefined;
  let nextPid = 1000;
  return {
    factory: (o) => (last = new FakePty(o, nextPid++)),
    get last(): FakePty {
      if (last === undefined) throw new Error("no fake pty has been spawned yet");
      return last;
    },
  };
}
