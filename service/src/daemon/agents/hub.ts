import { EventEmitter } from "node:events";
import type { ChatEvent, Pending, Strip } from "../../protocol/index.js";
import type { SessionRegistry } from "../sessions/registry.js";
import type { AgentSignal } from "../sessions/state.js";
import type { RolloutMeta } from "./codex/rollout.js";
import { HubSession, MAIN_THREAD, type AttachedSource } from "./hub-session.js";
import { ClaudeSource, CodexSource, type SourceSink } from "./hub-sources.js";
import { truncate } from "./summarize.js";

const DEFAULT_POLL_MS = 250;
/** Longest `lastMessage` taken from a transcript. */
const LAST_MESSAGE_MAX = 200;

type TurnKind = "turn_start" | "turn_end";

export interface ChatHubOptions {
  /** How often transcripts and sub-agent folders are polled. */
  pollMs?: number;
  /** An I/O failure reading one of a session's files; ignored by default. */
  onError?: (sessionId: string, err: Error) => void;
  now?: () => Date;
}

export interface ChatMessage {
  sessionId: string;
  threadId: string;
  event: ChatEvent;
}

export interface ChatHubEvents {
  /** An event to show, new or replacing the earlier one with the same id (an upsert). */
  chat: [message: ChatMessage];
  strip: [update: { sessionId: string; strip: Strip }];
}

/**
 * Each session's chat: what its agent's transcript (Claude) or rollout (Codex) says, read into
 * per-thread histories, plus turn and pending markers made from the session's signals. Lines
 * already in a file when it is attached become history only; lines appended later also signal
 * the session (a question opening or closing, a Codex turn starting or ending).
 *
 * The hub keeps state only for sessions the registry has, and drops it when one is removed.
 */
export class ChatHub extends EventEmitter<ChatHubEvents> {
  private readonly sessions = new Map<string, HubSession>();
  private readonly pollMs: number;
  private readonly onError: (sessionId: string, err: Error) => void;
  private readonly now: () => Date;

  constructor(
    private readonly registry: SessionRegistry,
    opts: ChatHubOptions = {},
  ) {
    super();
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.onError = opts.onError ?? (() => undefined);
    this.now = opts.now ?? (() => new Date());
    registry.on("signal", (sessionId, signal) => this.onSignal(sessionId, signal));
    registry.on("removed", (sessionId) => this.remove(sessionId));
  }

  /** Reads a Claude transcript into the main thread and its sub-agents' files into theirs. */
  attachClaude(sessionId: string, transcriptPath: string): void {
    this.attach(sessionId, (sink) => new ClaudeSource(transcriptPath, sink));
  }

  attachCodex(sessionId: string, rolloutPath: string): void {
    this.attach(sessionId, (sink) => new CodexSource(rolloutPath, sink));
  }

  /** Stops reading the session's files; its history stays. */
  detach(sessionId: string): void {
    this.sessions.get(sessionId)?.detach();
  }

  history(sessionId: string, threadId: string): ChatEvent[] {
    return this.sessions.get(sessionId)?.history(threadId) ?? [];
  }

  threads(sessionId: string): string[] {
    return this.sessions.get(sessionId)?.threads() ?? [];
  }

  latestStrip(sessionId: string): Strip | undefined {
    return this.sessions.get(sessionId)?.strip;
  }

  updateStrip(sessionId: string, strip: Strip): void {
    const session = this.session(sessionId);
    if (session === undefined) return;
    session.strip = strip;
    this.emit("strip", { sessionId, strip });
  }

  private attach(sessionId: string, create: (sink: SourceSink) => AttachedSource): void {
    const session = this.session(sessionId);
    session?.attach(create(this.sinkFor(sessionId, session)));
  }

  /** The hub's state for a session the registry has, created on first use. */
  private session(sessionId: string): HubSession | undefined {
    let session = this.sessions.get(sessionId);
    if (session === undefined && this.registry.get(sessionId) !== undefined) {
      session = new HubSession();
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private remove(sessionId: string): void {
    this.sessions.get(sessionId)?.detach();
    this.sessions.delete(sessionId);
  }

  private sinkFor(sessionId: string, session: HubSession): SourceSink {
    return {
      pollMs: this.pollMs,
      chat: (threadId, event) => this.show(sessionId, session, threadId, event),
      clear: (threadId) => session.clear(threadId),
      thread: (threadId) => session.addThread(threadId),
      signal: (signal) => {
        if (this.registry.get(sessionId) !== undefined) this.registry.signal(sessionId, signal);
      },
      strip: (strip) => this.updateStrip(sessionId, strip),
      meta: (meta) => this.codexMeta(sessionId, meta),
      error: (err) => this.onError(sessionId, err),
    };
  }

  private show(sessionId: string, session: HubSession, threadId: string, event: ChatEvent): void {
    session.upsert(threadId, event);
    this.emit("chat", { sessionId, threadId, event });
  }

  /** The rollout's thread id names the Codex conversation unless something already has. */
  private codexMeta(sessionId: string, meta: RolloutMeta): void {
    const record = this.registry.get(sessionId);
    if (meta.threadId === undefined || record === undefined) return;
    if (record.session.agentSessionId !== undefined) return;
    this.registry.setMeta(sessionId, { agentSessionId: meta.threadId });
  }

  /** Runs inside `registry.signal`, after the reducer and before "updated" and "notify". */
  private onSignal(sessionId: string, signal: AgentSignal): void {
    switch (signal.kind) {
      case "turn_start":
      case "turn_end":
        return this.turn(sessionId, signal);
      case "pending":
        return this.pending(sessionId, signal.pending);
      case "pending_cleared":
        return this.pendingCleared(sessionId, signal.pendingId);
      default:
        return;
    }
  }

  /** Marks a turn boundary in the main thread; a bare turn_end takes the transcript's text. */
  private turn(sessionId: string, signal: Extract<AgentSignal, { kind: TurnKind }>): void {
    const session = this.session(sessionId);
    if (session === undefined) return;
    this.show(sessionId, session, MAIN_THREAD, {
      id: session.nextTurnId(),
      threadId: MAIN_THREAD,
      at: this.now().toISOString(),
      kind: "turn",
      turn: { phase: signal.kind === "turn_start" ? "start" : "end" },
    });
    const text = session.attached?.lastAssistantText;
    if (signal.kind === "turn_end" && signal.lastMessage === undefined && text !== undefined) {
      this.registry.setMeta(sessionId, { lastMessage: truncate(text, LAST_MESSAGE_MAX) });
    }
  }

  /**
   * Shows a pending as a chat event with its id. When the transcript already showed that id (an
   * AskUserQuestion it read first), the pending is added to that event, which it already carries
   * unless the question was answered.
   */
  private pending(sessionId: string, pending: Pending): void {
    const session = this.session(sessionId);
    if (session === undefined) return;
    session.lastPendingId = pending.id;
    const shown = session.find(MAIN_THREAD, pending.id);
    if (shown?.pending !== undefined) return;
    const event: ChatEvent = shown
      ? { ...shown, pending }
      : {
          id: pending.id,
          threadId: MAIN_THREAD,
          at: this.now().toISOString(),
          kind: pending.kind,
          pending,
        };
    this.show(sessionId, session, MAIN_THREAD, event);
  }

  /** Shows the cleared pending's event resolved (without `pending`), unless it already is. */
  private pendingCleared(sessionId: string, pendingId?: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    const id = pendingId ?? session.lastPendingId;
    if (id === undefined) return;
    if (id === session.lastPendingId) session.lastPendingId = undefined;
    const shown = session.find(MAIN_THREAD, id);
    if (shown?.pending === undefined) return;
    const resolved = { ...shown };
    delete resolved.pending;
    this.show(sessionId, session, MAIN_THREAD, resolved);
  }
}
