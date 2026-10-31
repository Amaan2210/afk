import { mkdirSync } from "node:fs";
import path from "node:path";
import pino from "pino";

export interface LoggerOptions {
  verbose?: boolean;
  stdout?: boolean;
  /** Synchronous file writes. Intended for tests only. */
  sync?: boolean;
}

/**
 * JSON-lines logger writing to `<logDir>/afk-YYYY-MM-DD.log`.
 *
 * Rotation is by daily file name chosen at creation time (the daemon is restarted
 * regularly enough that this is sufficient); it needs no extra dependency.
 */
export function createLogger(logDir: string, opts: LoggerOptions = {}): pino.Logger {
  mkdirSync(logDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const dest = path.join(logDir, `afk-${day}.log`);
  const level = opts.verbose ? "debug" : "info";
  const streams: pino.StreamEntry[] = [
    { level, stream: pino.destination({ dest, mkdir: true, sync: opts.sync ?? false }) },
  ];
  if (opts.stdout) streams.push({ level, stream: process.stdout });
  return pino({ level }, pino.multistream(streams));
}
