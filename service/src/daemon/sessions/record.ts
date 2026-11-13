import path from "node:path";
import type { Session, SessionKind } from "../../protocol/index.js";
import type { SessionProcess } from "./session-process.js";
import { reduce, type AgentSignal, type NotifyKind, type StateSlice } from "./state.js";

/** Where an agent's own logs for this session live, once a hook or notify reports them. */
export interface SessionMeta {
  transcriptPath?: string;
  rolloutPath?: string;
}

export interface SessionRecord {
  session: Session;
  process?: SessionProcess;
  meta: SessionMeta;
  /**
   * Set by `kill` and `stopAll`. The exit code cannot say whether a session was killed: after a
   * kill it is whatever the pty reports.
   */
  killRequested: boolean;
}

/** The agent a session was first launched with, and its args, which `resume` reuses. */
export interface Origin {
  kind: SessionKind;
  args: string[];
}

/** A record and the registry's private bookkeeping for it. */
export interface Entry extends SessionRecord {
  origin: Origin;
  /** Typed into the shell on its first output, or when the fallback timer fires. */
  launchLine?: string;
  launchTimer?: NodeJS.Timeout;
  /** When "updated" was last emitted, in ms; activity updates are throttled against it. */
  lastUpdatedAt: number;
  unsubscribe: (() => void)[];
}

export interface NewEntry {
  id: string;
  name: string;
  cwd: string;
  kind: SessionKind;
  /** ISO time used for `createdAt` and `lastActivityAt`. */
  at: string;
  gitBranch: string | undefined;
  process: SessionProcess;
  launchLine: string | undefined;
  origin: Origin;
}

export function newEntry(o: NewEntry): Entry {
  const session: Session = {
    id: o.id,
    name: o.name,
    cwd: o.cwd,
    kind: o.kind,
    state: "idle",
    createdAt: o.at,
    lastActivityAt: o.at,
    subagentsRunning: 0,
  };
  setOptional(session, "gitBranch", o.gitBranch);
  const entry: Entry = {
    session,
    process: o.process,
    meta: {},
    killRequested: false,
    origin: o.origin,
    lastUpdatedAt: 0,
    unsubscribe: [],
  };
  if (o.launchLine !== undefined) entry.launchLine = o.launchLine;
  return entry;
}

export function notFound(id: string): Error {
  return new Error(`not_found: no session ${id}`);
}

export function badRequest(detail: string): Error {
  return new Error(`bad_request: ${detail}`);
}

/** The last segment of a Windows or POSIX path; a drive root such as `D:\` names itself `D:`. */
export function folderName(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  return path.win32.basename(trimmed) || trimmed || cwd;
}

/**
 * `wanted`, or the first of `wanted-2`, `wanted-3`, … that no live record other than `self` holds.
 * Ended sessions keep their names without blocking them.
 */
export function freeName(wanted: string, records: Iterable<Entry>, self?: Entry): string {
  const taken = new Set<string>();
  for (const r of records) {
    if (r !== self && r.session.state !== "ended") taken.add(r.session.name);
  }
  let name = wanted;
  for (let n = 2; taken.has(name); n++) name = `${wanted}-${n}`;
  return name;
}

const ESC = 0x1b;
const CSI_BRACKET = 0x5b;
const FOCUS_IN = 0x49; // I
const FOCUS_OUT = 0x4f; // O

/**
 * Whether `bytes` are only focus reports (`ESC [ I` and `ESC [ O`). An attached window sends one
 * each time it gains or loses focus while the agent's TUI has focus reporting on; that is not
 * the user answering anything.
 */
/** Whether `bytes` is the Esc key alone, not the start of another key's escape sequence. */
export function isLoneEscape(bytes: Buffer): boolean {
  return bytes.length === 1 && bytes[0] === ESC;
}

export function isFocusReport(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.length % 3 !== 0) return false;
  for (let i = 0; i < bytes.length; i += 3) {
    const final = bytes[i + 2];
    if (bytes[i] !== ESC || bytes[i + 1] !== CSI_BRACKET) return false;
    if (final !== FOCUS_IN && final !== FOCUS_OUT) return false;
  }
  return true;
}

type OptionalField = "pending" | "lastMessage" | "exitCode" | "gitBranch";

/** Sets an optional session field, deleting the key when the value is undefined. */
export function setOptional<K extends OptionalField>(s: Session, key: K, value: Session[K]): void {
  if (value === undefined) delete s[key];
  else s[key] = value;
}

/** The part of a session the state reducer owns. */
function sliceOf(s: Session): StateSlice {
  const slice: StateSlice = { state: s.state, subagentsRunning: s.subagentsRunning };
  if (s.pending !== undefined) slice.pending = s.pending;
  if (s.lastMessage !== undefined) slice.lastMessage = s.lastMessage;
  if (s.exitCode !== undefined) slice.exitCode = s.exitCode;
  return slice;
}

/** The reducer keeps `pending` by reference when it leaves it alone. */
function sliceChanged(a: StateSlice, b: StateSlice): boolean {
  return (
    a.state !== b.state ||
    a.subagentsRunning !== b.subagentsRunning ||
    a.pending !== b.pending ||
    a.lastMessage !== b.lastMessage ||
    a.exitCode !== b.exitCode
  );
}

/**
 * Runs `signal` through the reducer and writes the result back into `s`, removing fields the
 * reducer dropped (a cleared `pending`) and stamping `endedAt` when the session ends.
 */
export function applySignal(
  s: Session,
  signal: AgentSignal,
  now: () => Date,
): { changed: boolean; notify?: NotifyKind } {
  const before = sliceOf(s);
  const { slice, notify } = reduce(before, signal);
  const changed = sliceChanged(before, slice);
  if (changed) {
    s.state = slice.state;
    s.subagentsRunning = slice.subagentsRunning;
    setOptional(s, "pending", slice.pending);
    setOptional(s, "lastMessage", slice.lastMessage);
    setOptional(s, "exitCode", slice.exitCode);
    if (before.state !== "ended" && slice.state === "ended") s.endedAt = now().toISOString();
  }
  return { changed, notify };
}
