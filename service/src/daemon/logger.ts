import { mkdirSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import pino from "pino";

/** How long the daemon keeps a log file after its last write. */
const KEEP_LOGS_DAYS = 14;
const LOG_FILE = /^afk-\d{4}-\d{2}-\d{2}\.log$/;

function logName(day: Date): string {
  return `afk-${day.toISOString().slice(0, 10)}.log`;
}

export interface LoggerOptions {
  verbose?: boolean;
  stdout?: boolean;
  /** Synchronous file writes. Intended for tests only. */
  sync?: boolean;
}

/** How to close each logger's file, for `closeLogger`. */
const closers = new WeakMap<pino.Logger, () => Promise<void>>();

/**
 * JSON-lines logger writing to `<logDir>/afk-YYYY-MM-DD.log`.
 *
 * Rotation is by daily file name chosen at creation time (the daemon is restarted
 * regularly enough that this is sufficient); it needs no extra dependency.
 */
export function createLogger(logDir: string, opts: LoggerOptions = {}): pino.Logger {
  mkdirSync(logDir, { recursive: true });
  const dest = path.join(logDir, logName(new Date()));
  const level = opts.verbose ? "debug" : "info";
  const file = pino.destination({ dest, mkdir: true, sync: opts.sync ?? false });
  let closing: Promise<void> | undefined;
  // Once closing, the file drops lines instead of throwing: events still log while stopping.
  const toFile = { write: (line: string) => void (closing === undefined && file.write(line)) };
  const streams: pino.StreamEntry[] = [{ level, stream: toFile }];
  if (opts.stdout) streams.push({ level, stream: process.stdout });
  const logger = pino({ level }, pino.multistream(streams));
  closers.set(logger, () => {
    closing ??= new Promise((resolve) => {
      file.once("close", () => resolve());
      file.once("error", () => resolve());
      file.end();
    });
    return closing;
  });
  return logger;
}

/**
 * Writes out every line already queued for the log file and closes it; later lines go to stdout
 * only, if the logger has it. (`logger.flush` does not wait: a multistream has no flush of its own,
 * and the file does not buffer, so its flush returns while writes are still in flight.)
 */
export function closeLogger(logger: pino.Logger): Promise<void> {
  return closers.get(logger)?.() ?? Promise.resolve();
}

/**
 * Deletes the daemon's daily log files (`afk-YYYY-MM-DD.log`) last written more than 14 days
 * before `now`, never today's. Returns the names deleted; a missing folder has none.
 */
export async function pruneLogs(logDir: string, now: Date = new Date()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(logDir);
  } catch {
    return [];
  }
  const cutoff = now.getTime() - KEEP_LOGS_DAYS * 24 * 60 * 60 * 1000;
  const today = logName(now);
  const deleted: string[] = [];
  for (const name of names) {
    if (!LOG_FILE.test(name) || name === today) continue;
    const file = path.join(logDir, name);
    if ((await stat(file)).mtimeMs >= cutoff) continue;
    await rm(file, { force: true });
    deleted.push(name);
  }
  return deleted;
}
