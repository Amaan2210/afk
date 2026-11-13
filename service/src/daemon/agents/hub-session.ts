import type { ChatEvent, Strip } from "../../protocol/index.js";

/** The thread of the session's own conversation; sub-agent threads are named after their files. */
export const MAIN_THREAD = "main";

export type TurnPhase = "start" | "end";

/** An agent log being read into a session's chat. */
export interface AttachedSource {
  /** Text of the main thread's latest assistant message. */
  readonly lastAssistantText: string | undefined;
  start(): void;
  stop(): void;
  /** Reads what the files hold now: the main one first, then the sub-agents'. */
  flush(): void;
}

/**
 * One session's chat as the hub keeps it: each thread's events in the order their ids first
 * appeared, an event re-emitted with a known id replacing the old one in place; the latest status
 * strip; and the agent log attached to it, if any.
 */
export class HubSession {
  private readonly histories = new Map<string, Map<string, ChatEvent>>([[MAIN_THREAD, new Map()]]);
  private turns = 0;
  private lastPhase: TurnPhase | undefined;
  strip: Strip | undefined;
  /** Id of the last pending the session was given and the hub has not shown resolved yet. */
  lastPendingId: string | undefined;
  private source: AttachedSource | undefined;
  /** The file last attached, kept after detaching. */
  private path: string | undefined;
  private stopTimer: NodeJS.Timeout | undefined;
  /**
   * True from a turn's start until the main thread shows the agent's first reply to it (text, a
   * tool call, a question).
   */
  awaitingReply = false;
  /** The check an Esc key set off; see ChatHub. */
  escapeTimer: NodeJS.Timeout | undefined;

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

  /**
   * The id of the next turn marker (`turn-1`, `turn-2`, …). Every start gets one (an interrupted
   * turn has no end, so two starts can follow each other); an end right after another end gets
   * none, as Codex reports a turn's end twice.
   */
  turnMarkerId(phase: TurnPhase): string | undefined {
    if (phase === "end" && this.lastPhase === "end") return undefined;
    this.lastPhase = phase;
    this.turns += 1;
    return `turn-${this.turns}`;
  }

  get attached(): AttachedSource | undefined {
    return this.source;
  }

  /**
   * Starts reading `source` from `path`, after stopping whatever was attached before. A file other
   * than the one last attached starts the chat afresh: its event ids may repeat the old file's.
   * Returns the threads whose history that cleared (none when the file is the same).
   */
  attach(source: AttachedSource, path: string): string[] {
    this.detach();
    let cleared: string[] = [];
    if (this.path !== undefined && this.path !== path) {
      cleared = this.threads();
      this.histories.clear();
      this.histories.set(MAIN_THREAD, new Map());
      this.strip = undefined;
    }
    this.path = path;
    this.source = source;
    source.start();
    return cleared;
  }

  /** Detaches after `ms` unless detached or attached again first. */
  detachAfter(ms: number): void {
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => this.detach(), ms).unref();
  }

  /** Stops reading; the history and strip stay. */
  detach(): void {
    clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    clearTimeout(this.escapeTimer);
    this.escapeTimer = undefined;
    this.source?.stop();
    this.source = undefined;
  }
}
