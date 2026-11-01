import type { ChatEvent, Strip } from "../../protocol/index.js";
import type { AgentSignal } from "../sessions/state.js";
import { parentUuidOf, subagentDirFor, SubagentWatcher } from "./claude/subagents.js";
import { ClaudeTranscriptNormalizer, isInterruptLine } from "./claude/transcript.js";
import { CodexRolloutNormalizer, type RolloutMeta } from "./codex/rollout.js";
import { MAIN_THREAD, type AttachedSource } from "./hub-session.js";
import { JsonlTailer } from "./tail.js";

/** Where a source delivers what it reads. The hub binds one to each session. */
export interface SourceSink {
  readonly pollMs: number;
  /** `live`: the event comes from a line appended after its file was first read to the end. */
  chat(threadId: string, event: ChatEvent, live: boolean): void;
  /** A thread's file was truncated or replaced: its history is about to be read again. */
  clear(threadId: string): void;
  thread(threadId: string): void;
  /** A signal from a line appended after the source caught up; never from a replayed one. */
  signal(signal: AgentSignal): void;
  strip(strip: Strip): void;
  meta(meta: RolloutMeta): void;
  error(err: Error): void;
}

interface ThreadHandlers {
  /** `live` is false for lines that were already in the file when reading (re)started. */
  line(obj: unknown, live: boolean): void;
  /** The file shrank and will be replayed from its start. */
  reset(): void;
}

/** Tails one thread's JSONL file and tells the lines it replays from the ones appended later. */
class ThreadTail {
  private readonly tailer: JsonlTailer;
  private replaying = true;

  constructor(path: string, sink: SourceSink, handlers: ThreadHandlers) {
    this.tailer = new JsonlTailer(path, { pollMs: sink.pollMs });
    this.tailer.on("line", (obj) => handlers.line(obj, !this.replaying));
    this.tailer.on("caughtUp", () => (this.replaying = false));
    this.tailer.on("reset", () => {
      this.replaying = true;
      handlers.reset();
    });
    this.tailer.on("error", (err) => sink.error(err));
  }

  start(): void {
    this.tailer.start();
  }

  stop(): void {
    this.tailer.stop();
  }

  drain(): void {
    this.tailer.drain();
  }
}

/**
 * A Claude Code transcript and its sub-agents' transcripts, each its own thread. Only the main
 * transcript yields signals: an AskUserQuestion opening or closing changes the session's pending,
 * and an interrupt line aborts the turn. Sub-agents start and stop through hooks, not here.
 */
export class ClaudeSource implements AttachedSource {
  private main = new ClaudeTranscriptNormalizer(MAIN_THREAD);
  private readonly mainTail: ThreadTail;
  private readonly watcher: SubagentWatcher;
  private readonly subagentTails: ThreadTail[] = [];

  constructor(
    transcriptPath: string,
    private readonly sink: SourceSink,
  ) {
    this.mainTail = new ThreadTail(transcriptPath, sink, {
      line: (obj, live) => this.mainLine(obj, live),
      reset: () => {
        sink.clear(MAIN_THREAD);
        this.main = new ClaudeTranscriptNormalizer(MAIN_THREAD);
      },
    });
    this.watcher = new SubagentWatcher(subagentDirFor(transcriptPath), sink.pollMs);
    this.watcher.on("file", (path, threadId) => this.addSubagent(path, threadId));
  }

  get lastAssistantText(): string | undefined {
    return this.main.lastAssistantText;
  }

  /** The main transcript is read first, so its Agent calls are known when a sub-agent's file is. */
  start(): void {
    this.mainTail.start();
    this.watcher.start();
  }

  stop(): void {
    this.mainTail.stop();
    this.watcher.stop();
    for (const tail of this.subagentTails) tail.stop();
  }

  flush(): void {
    this.mainTail.drain();
    for (const tail of this.subagentTails) tail.drain();
  }

  private mainLine(obj: unknown, live: boolean): void {
    const before = this.main.pendingQuestion;
    for (const event of this.main.push(obj)) this.sink.chat(MAIN_THREAD, event, live);
    const after = this.main.pendingQuestion;
    if (!live) return;
    if (after?.id !== before?.id) {
      if (after !== undefined) this.sink.signal({ kind: "pending", pending: after });
      else if (before !== undefined)
        this.sink.signal({ kind: "pending_cleared", pendingId: before.id });
    }
    if (isInterruptLine(obj)) this.sink.signal({ kind: "turn_abort" });
  }

  private addSubagent(path: string, threadId: string): void {
    this.sink.thread(threadId);
    let normalizer = new ClaudeTranscriptNormalizer(threadId);
    let first = true;
    const tail = new ThreadTail(path, this.sink, {
      line: (obj, live) => {
        if (first) this.link(threadId, obj);
        first = false;
        for (const event of normalizer.push(obj)) this.sink.chat(threadId, event, live);
      },
      reset: () => {
        this.sink.clear(threadId);
        normalizer = new ClaudeTranscriptNormalizer(threadId);
      },
    });
    this.subagentTails.push(tail);
    tail.start();
  }

  /**
   * Points the main thread's running Agent call at the thread whose file starts with `line`: the
   * call its `fork-context-ref` names, else the oldest one not yet linked. The main transcript is
   * read first, as the call that started the sub-agent may have been written since its last poll.
   */
  private link(threadId: string, line: unknown): void {
    this.mainTail.drain();
    const parentUuid = parentUuidOf(line);
    let linked: ChatEvent | undefined;
    if (parentUuid !== undefined) linked = this.main.linkSubagentByParent(parentUuid, threadId);
    linked ??= this.main.linkNextSubagent(threadId);
    if (linked !== undefined) this.sink.chat(MAIN_THREAD, linked, false);
  }
}

/** A Codex rollout file: one thread, plus the turn signals, strips and meta it reports. */
export class CodexSource implements AttachedSource {
  private rollout = new CodexRolloutNormalizer(MAIN_THREAD);
  private readonly tail: ThreadTail;

  constructor(
    rolloutPath: string,
    private readonly sink: SourceSink,
  ) {
    this.tail = new ThreadTail(rolloutPath, sink, {
      line: (obj, live) => this.line(obj, live),
      reset: () => {
        sink.clear(MAIN_THREAD);
        this.rollout = new CodexRolloutNormalizer(MAIN_THREAD);
      },
    });
  }

  get lastAssistantText(): string | undefined {
    return this.rollout.lastAssistantText;
  }

  start(): void {
    this.tail.start();
  }

  stop(): void {
    this.tail.stop();
  }

  flush(): void {
    this.tail.drain();
  }

  private line(obj: unknown, live: boolean): void {
    const { events, signals, strip, meta } = this.rollout.push(obj);
    for (const event of events) this.sink.chat(MAIN_THREAD, event, live);
    if (strip !== undefined) this.sink.strip(strip);
    if (meta !== undefined) this.sink.meta(meta);
    if (live) for (const signal of signals) this.sink.signal(signal);
  }
}
