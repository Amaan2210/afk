import { open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../../../util/is-record.js";

/** Bytes read per step while looking for the end of a rollout's first line. */
const CHUNK = 64 * 1024;
/** A first line longer than this is not a session_meta we can use. */
const MAX_FIRST_LINE = 4 * 1024 * 1024;
const NAME_TIME = /^rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-/;

export interface RolloutQuery {
  threadId?: string;
  cwd?: string;
  since?: Date;
}

export interface SessionIndexEntry {
  id: string;
  threadName?: string;
  updatedAt?: string;
}

/**
 * Finds the rollout file under `sessionsDir` (`YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`) for a
 * thread id, else for a working directory (and a start no earlier than `since`). Returns the
 * newest match, searching the newest days first, or undefined when nothing matches.
 */
export async function findRolloutFile(
  sessionsDir: string,
  q: RolloutQuery,
): Promise<string | undefined> {
  const wantCwd = q.cwd === undefined ? undefined : normalizePath(q.cwd);
  if (q.threadId === undefined && wantCwd === undefined) return undefined;
  for (const day of await dayDirs(sessionsDir)) {
    const names = (await listDir(day)).filter(isRollout).sort().reverse();
    for (const name of names) {
      const file = join(day, name);
      if (q.threadId !== undefined) {
        if (name.endsWith(`-${q.threadId}.jsonl`)) return file;
      } else if (wantCwd !== undefined && (await matchesCwd(file, name, wantCwd, q.since))) {
        return file;
      }
    }
  }
  return undefined;
}

/** The entries of Codex's `session_index.jsonl`; malformed lines and a missing file are skipped. */
export async function readSessionIndex(indexPath: string): Promise<SessionIndexEntry[]> {
  let text: string;
  try {
    text = await readFile(indexPath, "utf8");
  } catch {
    return [];
  }
  const entries: SessionIndexEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const value = parseJson(line);
    if (!isRecord(value) || typeof value.id !== "string") continue;
    const entry: SessionIndexEntry = { id: value.id };
    if (typeof value.thread_name === "string") entry.threadName = value.thread_name;
    if (typeof value.updated_at === "string") entry.updatedAt = value.updated_at;
    entries.push(entry);
  }
  return entries;
}

function isRollout(name: string): boolean {
  return name.startsWith("rollout-") && name.endsWith(".jsonl");
}

/** Every `YYYY/MM/DD` directory under `root`, newest first. */
async function dayDirs(root: string): Promise<string[]> {
  const days: string[] = [];
  for (const year of await numericDirs(root)) {
    for (const month of await numericDirs(year)) days.push(...(await numericDirs(month)));
  }
  return days;
}

/** The subdirectories of `dir` named only by digits, newest (highest name) first. */
async function numericDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function matchesCwd(
  file: string,
  name: string,
  wantCwd: string,
  since: Date | undefined,
): Promise<boolean> {
  const first = parseJson(await readFirstLine(file));
  if (!isRecord(first) || first.type !== "session_meta" || !isRecord(first.payload)) return false;
  if (typeof first.payload.cwd !== "string" || normalizePath(first.payload.cwd) !== wantCwd) {
    return false;
  }
  if (since === undefined) return true;
  const started = startTime(first, name);
  return started !== undefined && started >= since.getTime();
}

/** When a rollout started: the meta's own timestamp, else the line's, else the file name's. */
function startTime(first: Record<string, unknown>, name: string): number | undefined {
  const payload = first.payload as Record<string, unknown>;
  for (const candidate of [payload.timestamp, first.timestamp]) {
    const ms = typeof candidate === "string" ? Date.parse(candidate) : NaN;
    if (!Number.isNaN(ms)) return ms;
  }
  const m = NAME_TIME.exec(name);
  if (m === null) return undefined;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The first line of a file, reading in chunks; "" when it cannot be read. */
async function readFirstLine(file: string): Promise<string> {
  let handle;
  try {
    handle = await open(file, "r");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(buf, 0, CHUNK, total);
      if (bytesRead === 0) break;
      const chunk = buf.subarray(0, bytesRead);
      const newline = chunk.indexOf(0x0a);
      if (newline !== -1) {
        chunks.push(chunk.subarray(0, newline));
        break;
      }
      chunks.push(chunk);
      total += bytesRead;
      if (total > MAX_FIRST_LINE) return "";
    }
    return Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
