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

/** A record and the registry's private bookkeeping for it. */
export interface Entry extends SessionRecord {
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
