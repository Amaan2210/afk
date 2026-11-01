import { EventEmitter } from "node:events";
import type { ChatEvent, Pending, Strip } from "../../protocol/index.js";
import type { SessionRegistry } from "../sessions/registry.js";
import type { AgentSignal } from "../sessions/state.js";
import type { RolloutMeta } from "./codex/rollout.js";
import { HubSession, MAIN_THREAD, type AttachedSource } from "./hub-session.js";
import { ClaudeSource, CodexSource, type SourceSink } from "./hub-sources.js";
import { truncate } from "./summarize.js";

const DEFAULT_POLL_MS = 250;
const DEFAULT_EXIT_GRACE_MS = 5000;
/** Longest `lastMessage` taken from a transcript, the ellipsis included. */
const LAST_MESSAGE_MAX = 200;

type TurnKind = "turn_start" | "turn_end";

export interface ChatHubOptions {
  /** How often transcripts and sub-agent folders are polled. */
  pollMs?: number;
  /** How long a session's files are still read after its process exits. */
  exitGraceMs?: number;
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
  /** A thread's history was cleared and is about to be read again: re-fetch it with `history`. */
  reset: [thread: { sessionId: string; threadId: string }];
}

/**
 * Each session's chat: what its agent's transcript (Claude) or rollout (Codex) says, read into
 * per-thread histories, plus turn and pending markers made from the session's signals. Lines
 * already in a file when it is attached become history only; lines appended later also signal
 * the session (a question opening or closing, a Codex turn starting or ending).
 *
 * The hub keeps state only for sessions the registry has, stops reading a session's files a
 * grace period after its process exits, and drops its state when the session is removed.
 */
export class ChatHub extends EventEmitter<ChatHubEvents> {
  private readonly sessions = new Map<string, HubSession>();
  private readonly pollMs: number;
  private readonly exitGraceMs: number;
  private readonly onError: (sessionId: string, err: Error) => void;
  private readonly now: () => Date;

  constructor(
    private readonly registry: SessionRegistry,
    opts: ChatHubOptions = {},
  ) {
    super();
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.exitGraceMs = opts.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS;
    this.onError = opts.onError ?? (() => undefined);
    this.now = opts.now ?? (() => new Date());
    registry.on("signal", (sessionId, signal) => this.onSignal(sessionId, signal));
    registry.on("exit", (sessionId) => this.onExit(sessionId));
    registry.on("removed", (sessionId) => this.remove(sessionId));
  }

  /** Reads a Claude transcript into the main thread and its sub-agents' files into theirs. */
  attachClaude(sessionId: string, transcriptPath: string): void {
    this.attach(sessionId, transcriptPath, (sink) => new ClaudeSource(transcriptPath, sink));
  }

  attachCodex(sessionId: string, rolloutPath: string): void {
    this.attach(sessionId, rolloutPath, (sink) => new CodexSource(rolloutPath, sink));
  }

  /** Stops reading the session's files; its history stays. */
  detach(sessionId: string): void {
    this.sessions.get(sessionId)?.detach();
  }

  /**
   * Reads what the session's files hold now instead of at the next poll. Call it before applying
   * a hook's signal, so the lines the agent wrote before the hook ran come first.
   */
  flush(sessionId: string): void {
    this.sessions.get(sessionId)?.attached?.flush();
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

  private attach(
    sessionId: string,
    path: string,
    create: (sink: SourceSink) => AttachedSource,
  ): void {
    const session = this.session(sessionId);
    if (session === undefined) return;
    const cleared = session.attach(create(this.sinkFor(sessionId, session)), path);
    for (const threadId of cleared) this.emit("reset", { sessionId, threadId });
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

  /** The agent may still be flushing its last lines: keep reading a little, then stop. */
  private onExit(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.attached !== undefined) session.detachAfter(this.exitGraceMs);
  }

  private remove(sessionId: string): void {
    this.sessions.get(sessionId)?.detach();
    this.sessions.delete(sessionId);
  }

  private sinkFor(sessionId: string, session: HubSession): SourceSink {
    return {
      pollMs: this.pollMs,
      chat: (threadId, event, live) => {
        this.show(sessionId, session, threadId, event);
        if (live && threadId === MAIN_THREAD && event.kind === "assistant" && event.text) {
          this.lateReply(sessionId, event.text);
        }
      },
      clear: (threadId) => {
        session.clear(threadId);
        this.emit("reset", { sessionId, threadId });
      },
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

  /** A reply read after the turn ended (the Stop hook won the race) is still its last message. */
  private lateReply(sessionId: string, text: string): void {
    if (this.registry.get(sessionId)?.session.state !== "finished") return;
    this.registry.setMeta(sessionId, { lastMessage: lastMessageOf(text) });
  }

  /** The rollout's thread id names the Codex conversation unless something already has. */
  private codexMeta(sessionId: string, meta: RolloutMeta): void {
    const record = this.registry.get(sessionId);
    if (meta.threadId === undefined || record === undefined) return;
    if (record.session.agentSessionId !== undefined) return;
    this.registry.setMeta(sessionId, { agentSessionId: meta.threadId });
  }

  /**
   * Runs inside `registry.signal`, after the reducer and before "updated" and "notify", so it must
   * not read files: callers flush first.
   */
  private onSignal(sessionId: string, signal: AgentSignal): void {
    this.resolveDropped(sessionId);
    switch (signal.kind) {
      case "turn_start":
      case "turn_end":
        return this.turn(sessionId, signal);
      case "pending":
        return this.pending(sessionId, signal.pending);
      case "pending_cleared":
        return this.pendingCleared(sessionId, signal.pendingId);
      // An aborted turn gets no marker: it did not finish, and the next prompt's start shows the
      // boundary.
      case "turn_abort":
      default:
        return;
    }
  }

  /**
   * The reducer drops a session's pending on more than `pending_cleared`: a newer pending, a turn
   * boundary, the process exiting. Whatever dropped it, its card is shown resolved.
   */
  private resolveDropped(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    const id = session?.lastPendingId;
    if (session === undefined || id === undefined) return;
    if (this.registry.get(sessionId)?.session.pending?.id === id) return;
    session.lastPendingId = undefined;
    this.resolve(sessionId, session, id);
  }

  /**
   * Marks a turn boundary in the main thread; a bare turn_end takes the transcript's text. An end
   * is marked only when the reducer finished the session: one it ignored (sub-agents still
   * running) is no boundary.
   */
  private turn(sessionId: string, signal: Extract<AgentSignal, { kind: TurnKind }>): void {
    const session = this.session(sessionId);
    if (session === undefined) return;
    const phase = signal.kind === "turn_start" ? "start" : "end";
    const finished = this.registry.get(sessionId)?.session.state === "finished";
    const id = phase === "end" && !finished ? undefined : session.turnMarkerId(phase);
    if (id !== undefined) {
      const at = this.now().toISOString();
      this.show(sessionId, session, MAIN_THREAD, {
        id,
        threadId: MAIN_THREAD,
        at,
        kind: "turn",
        turn: { phase },
      });
    }
    const text = session.attached?.lastAssistantText;
    if (signal.kind === "turn_end" && signal.lastMessage === undefined && text !== undefined) {
      this.registry.setMeta(sessionId, { lastMessage: lastMessageOf(text) });
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

  private pendingCleared(sessionId: string, pendingId?: string): void {
    const session = this.sessions.get(sessionId);
    const id = pendingId ?? session?.lastPendingId;
    if (session === undefined || id === undefined) return;
    if (id === session.lastPendingId) session.lastPendingId = undefined;
    this.resolve(sessionId, session, id);
  }

  /** Shows the event with this id without its `pending`, unless it is already shown so. */
  private resolve(sessionId: string, session: HubSession, id: string): void {
    const shown = session.find(MAIN_THREAD, id);
    if (shown?.pending === undefined) return;
    const resolved = { ...shown };
    delete resolved.pending;
    this.show(sessionId, session, MAIN_THREAD, resolved);
  }
}

/** `text` as a session's `lastMessage`: at most LAST_MESSAGE_MAX characters, ellipsis included. */
function lastMessageOf(text: string): string {
  return text.length > LAST_MESSAGE_MAX ? truncate(text, LAST_MESSAGE_MAX - 1) : text;
}
