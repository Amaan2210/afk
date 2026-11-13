// The registry's options, requests and events.
import type { Session, SessionKind } from "../../protocol/index.js";
import type { PtyFactory } from "./pty.js";
import type { SessionRecord } from "./record.js";
import type { ShellInfo } from "./shell.js";
import type { AgentSignal, NotifyKind } from "./state.js";

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
  /** A client sent the Esc key alone, after it reached the session's terminal. */
  escape: [sessionId: string];
}
