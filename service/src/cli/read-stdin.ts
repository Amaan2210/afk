import type { Readable } from "node:stream";

/** How long reading waits for the next byte before giving up. */
export const STDIN_IDLE_MS = 300;
/** How long reading takes at most, however the stream behaves. */
export const STDIN_CAP_MS = 1000;

export type StdinCut = "idle" | "cap";

export interface ReadStdinOptions {
  /** Gives up when no byte has arrived for this long (default `STDIN_IDLE_MS`). */
  idleMs?: number;
  /** Gives up this long after starting (default `STDIN_CAP_MS`). */
  capMs?: number;
  /** Called when reading gave up before the stream ended, with the bytes read until then. */
  onCut?: (why: StdinCut, bytes: number) => void;
}

/**
 * Reads a stream to its end as UTF-8, so a relay never hangs on a stdin nobody closes: it gives
 * up when no byte has arrived for `idleMs`, or `capMs` after it started, and returns what arrived.
 * A payload that keeps arriving is read whole as long as it ends within the cap.
 */
export function readStdin(stream: Readable, opts: ReadStdinOptions = {}): Promise<string> {
  const idleMs = opts.idleMs ?? STDIN_IDLE_MS;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const finish = (why?: StdinCut): void => {
      clearTimeout(idle);
      clearTimeout(cap);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onEnd);
      stream.off("close", onEnd);
      if (why !== undefined) opts.onCut?.(why, bytes);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onEnd = (): void => finish();
    const onData = (c: Buffer | string): void => {
      const chunk = Buffer.from(c);
      chunks.push(chunk);
      bytes += chunk.length;
      idle.refresh();
    };
    const idle = setTimeout(() => finish("idle"), idleMs);
    const cap = setTimeout(() => finish("cap"), opts.capMs ?? STDIN_CAP_MS);
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onEnd);
    stream.once("close", onEnd);
  });
}

/** Parses JSON, or undefined when it is not valid JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
