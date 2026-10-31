import type { ChatEvent, Strip } from "../../protocol/index.js";

/** The thread of the session's own conversation; sub-agent threads are named after their files. */
export const MAIN_THREAD = "main";

/** An agent log being read into a session's chat. */
export interface AttachedSource {
  /** Text of the main thread's latest assistant message. */
  readonly lastAssistantText: string | undefined;
  start(): void;
  stop(): void;
}

/**
 * One session's chat as the hub keeps it: each thread's events in the order their ids first
 * appeared, an event re-emitted with a known id replacing the old one in place; the latest status
 * strip; and the agent log attached to it, if any.
 */
export class HubSession {
  private readonly histories = new Map<string, Map<string, ChatEvent>>([[MAIN_THREAD, new Map()]]);
  private turns = 0;
  strip: Strip | undefined;
  /** Id of the last pending the session was given, for a `pending_cleared` that names none. */
  lastPendingId: string | undefined;
  private source: AttachedSource | undefined;

  /** `main`, then the sub-agent threads in the order they were discovered. */
  threads(): string[] {
    return [...this.histories.keys()];
  }

  history(threadId: string): ChatEvent[] {
    return [...(this.histories.get(threadId)?.values() ?? [])];
  }

  find(threadId: string, eventId: string): ChatEvent | undefined {
    return this.histories.get(threadId)?.get(eventId);
  }

  addThread(threadId: string): void {
    if (!this.histories.has(threadId)) this.histories.set(threadId, new Map());
  }

  upsert(threadId: string, event: ChatEvent): void {
    this.addThread(threadId);
    this.histories.get(threadId)?.set(event.id, event);
  }

  /** Forgets a thread's events but keeps the thread: its file is about to be read again. */
  clear(threadId: string): void {
    this.histories.get(threadId)?.clear();
  }

  /** `turn-1`, `turn-2`, … for this session's turn markers. */
  nextTurnId(): string {
    this.turns += 1;
    return `turn-${this.turns}`;
  }

  get attached(): AttachedSource | undefined {
    return this.source;
  }

  /** Starts reading `source`, after stopping whatever was attached before. */
  attach(source: AttachedSource): void {
    this.detach();
    this.source = source;
    source.start();
  }

  detach(): void {
    this.source?.stop();
    this.source = undefined;
  }
}
