import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session, SessionKind } from "../../protocol/index.js";
import { newSessionId } from "../../util/ids.js";
import { currentBranch } from "./git.js";
import { buildLaunchLine } from "./launch-line.js";
import { renderSessionProfile } from "./profile.js";
import type { PtyFactory } from "./pty.js";
import {
  applySignal,
  badRequest,
  folderName,
  newEntry,
  notFound,
  setOptional,
  type Entry,
  type SessionRecord,
} from "./record.js";
import { SessionProcess } from "./session-process.js";
import { shellArgs, type ShellInfo } from "./shell.js";
import type { AgentSignal, NotifyKind } from "./state.js";

export type { SessionMeta, SessionRecord } from "./record.js";

/** How long a new session waits for the shell's first output before typing the launch line. */
const LAUNCH_FALLBACK_MS = 3000;
/** Output bumps `lastActivityAt` on every chunk but emits "updated" at most this often. */
const ACTIVITY_UPDATE_MS = 5000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

export interface RegistryDeps {
  ptyFactory: PtyFactory;
  shell: ShellInfo;
  sessionsDir: string;
  port: number;
  nodeExe: string;
  cliEntry: string;
  ringBufferBytes: number;
  snapshotScrollback: number;
  retentionHours: number;
  now?: () => Date;
  /** The environment session shells start with; defaults to the daemon's own. */
  baseEnv?: Record<string, string>;
}

export interface CreateOptions {
  cwd: string;
  kind: SessionKind;
  args: string[];
  name?: string;
  prompt?: string;
  cols?: number;
  rows?: number;
}

export type MetaPatch = Partial<SessionRecord["meta"]> &
  Partial<Pick<Session, "kind" | "agentSessionId" | "lastMessage">>;

export interface RegistryEvents {
  updated: [session: Session];
  removed: [sessionId: string];
  notify: [event: { kind: NotifyKind; session: Session }];
  data: [sessionId: string, chunk: Buffer];
  exit: [sessionId: string, exitCode: number];
  /** Every signal applied to a session, after the reducer and before "updated". */
  signal: [sessionId: string, signal: AgentSignal];
}

interface SpawnPlan {
  cwd: string;
  kind: SessionKind;
  name: string;
  launchLine: string | undefined;
  cols: number;
  rows: number;
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return env;
}

/**
 * The daemon's sessions. Each one is a PowerShell running the session profile, into which the
 * agent's launch line is typed. Agent signals go through the pure reducer in `state.ts`.
 *
 * Methods taking a session id throw an Error whose message starts with `not_found:` for an
 * unknown id, and `bad_request:` for a request the session cannot satisfy. Sessions handed out
 * (return values and event payloads) are copies; `get` returns the live record.
 */
export class SessionRegistry extends EventEmitter<RegistryEvents> {
  private readonly records = new Map<string, Entry>();
  private readonly now: () => Date;
  private readonly baseEnv: Record<string, string>;

  constructor(private readonly deps: RegistryDeps) {
    super();
    this.now = deps.now ?? (() => new Date());
    this.baseEnv = deps.baseEnv ?? processEnv();
  }

  async create(o: CreateOptions): Promise<Session> {
    const launchLine = buildLaunchLine(o.kind, o.args, o.prompt);
    return this.spawn({
      cwd: o.cwd,
      kind: o.kind,
      name: o.name || folderName(o.cwd),
      launchLine,
      cols: o.cols ?? DEFAULT_COLS,
      rows: o.rows ?? DEFAULT_ROWS,
    });
  }

  get(id: string): SessionRecord | undefined {
    return this.records.get(id);
  }

  list(): Session[] {
    return [...this.records.values()].map((rec) => structuredClone(rec.session));
  }

  /** Ends the session's process; the session ends when the pty reports the exit. */
  kill(id: string): void {
    const rec = this.require(id);
    if (rec.session.state !== "ended") this.terminate(rec);
  }

  rename(id: string, name: string): void {
    const rec = this.require(id);
    rec.session.name = name;
    this.emitUpdated(rec);
  }

  /** A new session in the same folder that resumes the ended session's agent conversation. */
  async resume(id: string): Promise<Session> {
    const source = this.require(id).session;
    const agentId = source.agentSessionId;
    if (source.state !== "ended") throw badRequest(`session ${id} has not ended`);
    if (agentId === undefined || source.kind === "shell") {
      throw badRequest(`session ${id} has no agent conversation to resume`);
    }
    const args = source.kind === "claude" ? ["--resume", agentId] : ["resume", agentId];
    return this.spawn({
      cwd: source.cwd,
      kind: source.kind,
      name: source.name,
      launchLine: buildLaunchLine(source.kind, args),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });
  }

  signal(id: string, s: AgentSignal): void {
    const rec = this.require(id);
    this.apply(rec, s);
    this.refreshBranch(rec);
  }

  setMeta(id: string, m: MetaPatch): void {
    const rec = this.require(id);
    if (m.transcriptPath !== undefined) rec.meta.transcriptPath = m.transcriptPath;
    if (m.rolloutPath !== undefined) rec.meta.rolloutPath = m.rolloutPath;
    if (m.kind !== undefined) rec.session.kind = m.kind;
    if (m.agentSessionId !== undefined) rec.session.agentSessionId = m.agentSessionId;
    if (m.lastMessage !== undefined) rec.session.lastMessage = m.lastMessage;
    this.emitUpdated(rec);
  }

  /** Keystrokes from a client. */
  input(id: string, bytes: Buffer): void {
    const rec = this.require(id);
    rec.process?.write(bytes);
    this.apply(rec, { kind: "user_input" });
  }

  pruneEnded(): void {
    const cutoff = this.now().getTime() - this.deps.retentionHours * 3_600_000;
    for (const [id, rec] of this.records) {
      const endedAt = rec.session.endedAt;
      if (endedAt === undefined || Date.parse(endedAt) >= cutoff) continue;
      this.records.delete(id);
      this.emit("removed", id);
    }
  }

  stopAll(): void {
    for (const rec of this.records.values()) {
      if (rec.session.state !== "ended") this.terminate(rec);
    }
  }

  private require(id: string): Entry {
    const rec = this.records.get(id);
    if (rec === undefined) throw notFound(id);
    return rec;
  }

  private async spawn(plan: SpawnPlan): Promise<Session> {
    const { sessionsDir, port, nodeExe, cliEntry } = this.deps;
    const id = newSessionId();
    const dir = path.join(sessionsDir, id);
    const profilePath = path.join(dir, "profile.ps1");
    const profile = renderSessionProfile({ sessionId: id, port, nodeExe, cliEntry });
    const [gitBranch] = await Promise.all([
      currentBranch(plan.cwd),
      mkdir(dir, { recursive: true }).then(() => writeFile(profilePath, profile, "utf8")),
    ]);
    const proc = new SessionProcess({
      ptyFactory: this.deps.ptyFactory,
      exe: this.deps.shell.exe,
      args: shellArgs(profilePath),
      cwd: plan.cwd,
      env: { ...this.baseEnv, AFK_SESSION_ID: id, AFK_PORT: String(port) },
      cols: plan.cols,
      rows: plan.rows,
      ringBufferBytes: this.deps.ringBufferBytes,
      snapshotScrollback: this.deps.snapshotScrollback,
    });
    const at = this.now().toISOString();
    const rec = newEntry({ ...plan, id, at, gitBranch, process: proc });
    this.records.set(id, rec);
    rec.unsubscribe.push(
      proc.onData((chunk) => this.handleData(rec, chunk)),
      proc.onExit((code) => this.handleExit(rec, code)),
    );
    if (plan.launchLine !== undefined) {
      rec.launchTimer = setTimeout(() => this.typeLaunchLine(rec), LAUNCH_FALLBACK_MS).unref();
    }
    this.emitUpdated(rec);
    return structuredClone(rec.session);
  }

  private handleData(rec: Entry, chunk: Buffer): void {
    this.typeLaunchLine(rec);
    const now = this.now();
    rec.session.lastActivityAt = now.toISOString();
    this.emit("data", rec.session.id, chunk);
    if (now.getTime() - rec.lastUpdatedAt >= ACTIVITY_UPDATE_MS) this.emitUpdated(rec);
  }

  private handleExit(rec: Entry, code: number): void {
    // node-pty passes its exit code through unchecked.
    const exitCode = Number.isInteger(code) ? code : -1;
    this.cancelLaunch(rec);
    for (const off of rec.unsubscribe.splice(0)) off();
    this.apply(rec, { kind: "process_exit", exitCode });
    this.emit("exit", rec.session.id, exitCode);
  }

  /** Runs a signal through the reducer, then emits "signal", "updated" if it changed, "notify". */
  private apply(rec: Entry, signal: AgentSignal): void {
    const { changed, notify } = applySignal(rec.session, signal, this.now);
    this.emit("signal", rec.session.id, signal);
    if (changed) this.emitUpdated(rec);
    if (notify) this.emit("notify", { kind: notify, session: structuredClone(rec.session) });
  }

  /** Re-reads the branch in the background and emits "updated" only if it changed. */
  private refreshBranch(rec: Entry): void {
    if (rec.session.state === "ended") return;
    currentBranch(rec.session.cwd)
      .then((branch) => {
        if (this.records.get(rec.session.id) !== rec || branch === rec.session.gitBranch) return;
        setOptional(rec.session, "gitBranch", branch);
        this.emitUpdated(rec);
      })
      // A throwing "updated" listener has no caller to reach here; it must not crash the daemon.
      .catch(() => undefined);
  }

  private typeLaunchLine(rec: Entry): void {
    const line = rec.launchLine;
    this.cancelLaunch(rec);
    if (line !== undefined) rec.process?.write(Buffer.from(line, "utf8"));
  }

  private cancelLaunch(rec: Entry): void {
    clearTimeout(rec.launchTimer);
    delete rec.launchTimer;
    delete rec.launchLine;
  }

  private terminate(rec: Entry): void {
    rec.killRequested = true;
    this.cancelLaunch(rec);
    rec.process?.kill();
  }

  private emitUpdated(rec: Entry): void {
    rec.lastUpdatedAt = this.now().getTime();
    this.emit("updated", structuredClone(rec.session));
  }
}
