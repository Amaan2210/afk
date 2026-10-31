import type { ChatEvent, Pending } from "../../../protocol/index.js";
import { isRecord } from "../../../util/is-record.js";
import { summarizeToolInput, truncate } from "../summarize.js";

/** Longest tool input or result carried in a chat event. */
const MAX_TOOL_TEXT = 4000;
const SUBAGENT_TOOL = "Agent";
const QUESTION_TOOL = "AskUserQuestion";
const DEFAULT_SUBAGENT = "general-purpose";
const RECOMMENDED = /\s*\(recommended\)\s*/i;

type Block = Record<string, unknown>;
type QuestionPending = Extract<Pending, { kind: "question" }>;
type QuestionOption = QuestionPending["options"][number];

/**
 * Turns the lines of one Claude Code transcript (the main session file or one sub-agent's file)
 * into chat events for one thread. Only `user` and `assistant` lines with a `message` produce
 * events; every other line type, known or not, is ignored. Text events take the line's `uuid`
 * as id; tool, sub-agent and question events take the tool_use id and are emitted again with
 * the same id (an upsert) when their tool_result arrives. Every event returned is a fresh object
 * that is never changed afterwards.
 *
 * A running sub-agent is threaded on its tool_use id until something links it to the thread of
 * its own transcript: the hub, when the sub-agent's file appears, or the tool result's
 * `toolUseResult.agentId`, which is final.
 */
export class ClaudeTranscriptNormalizer {
  /** Latest event of each tool_use still waiting for its result. */
  private readonly open = new Map<string, ChatEvent>();
  /** Running, unlinked Agent tool_use id → uuid of the assistant line holding it; oldest first. */
  private readonly unlinked = new Map<string, string>();
  private readonly links = new Map<string, string>();
  private lastAt: string | undefined;
  private lastText: string | undefined;
  private question: QuestionPending | undefined;

  constructor(private readonly threadId: string) {}

  /** Text of the latest assistant text event. */
  get lastAssistantText(): string | undefined {
    return this.lastText;
  }

  /** The question of an AskUserQuestion call that has no result yet. */
  get pendingQuestion(): Pending | undefined {
    return this.question;
  }

  /** Agent tool_use id → the thread id of its sub-agent transcript (`agent-<id>`). */
  get subagentLinks(): ReadonlyMap<string, string> {
    return this.links;
  }

  /** The events one transcript line produces or updates, in order; never throws. */
  push(line: unknown): ChatEvent[] {
    if (!isRecord(line) || (line.type !== "user" && line.type !== "assistant")) return [];
    if (!isRecord(line.message)) return [];
    const at = typeof line.timestamp === "string" ? line.timestamp : this.fallbackTime();
    const uuid = typeof line.uuid === "string" ? line.uuid : undefined;
    const blocks = contentBlocks(line.message.content);
    const events =
      line.type === "assistant"
        ? this.assistantLine(blocks, uuid, at)
        : this.userLine(blocks, uuid, at, line.toolUseResult);
    if (events.length > 0) this.lastAt = at;
    return events;
  }

  /**
   * Links the first running, unlinked Agent call made by the assistant line `parentUuid` (the
   * `parentLastUuid` of a sub-agent file's `fork-context-ref` line) to `threadId`.
   */
  linkSubagentByParent(parentUuid: string, threadId: string): ChatEvent | undefined {
    for (const [id, lineUuid] of this.unlinked) {
      if (lineUuid === parentUuid) return this.link(id, threadId);
    }
    return undefined;
  }

  /** Links the oldest running, unlinked Agent call to `threadId` (fallback for no parent match). */
  linkNextSubagent(threadId: string): ChatEvent | undefined {
    const oldest = this.unlinked.keys().next();
    return oldest.done ? undefined : this.link(oldest.value, threadId);
  }

  private link(id: string, threadId: string): ChatEvent | undefined {
    // A thread belongs to one Agent call. A sub-agent file noticed after its call already
    // finished (and was linked by its result) must not be handed to another running call.
    if ([...this.links.values()].includes(threadId)) return undefined;
    const prev = this.open.get(id);
    if (prev?.subagent === undefined) return undefined;
    this.unlinked.delete(id);
    this.links.set(id, threadId);
    const next: ChatEvent = { ...prev, subagent: { ...prev.subagent, threadId } };
    this.open.set(id, next);
    return next;
  }

  private assistantLine(blocks: Block[], uuid: string | undefined, at: string): ChatEvent[] {
    const events: ChatEvent[] = [];
    const text = joinText(blocks);
    if (text !== undefined && uuid !== undefined) {
      events.push(this.event(uuid, at, "assistant", { text }));
      this.lastText = text;
    }
    for (const block of blocks) {
      if (block.type !== "tool_use") continue;
      if (typeof block.id !== "string" || typeof block.name !== "string") continue;
      const event = this.toolStart(block.id, block.name, block.input, at, uuid);
      this.open.set(block.id, event);
      events.push(event);
    }
    return events;
  }

  private toolStart(
    id: string,
    name: string,
    input: unknown,
    at: string,
    lineUuid: string | undefined,
  ): ChatEvent {
    if (name === SUBAGENT_TOOL) {
      const args = isRecord(input) ? input : {};
      this.unlinked.set(id, lineUuid ?? "");
      return this.event(id, at, "subagent", {
        subagent: {
          threadId: id,
          name: typeof args.subagent_type === "string" ? args.subagent_type : DEFAULT_SUBAGENT,
          task: typeof args.description === "string" ? args.description : "",
          status: "running",
          toolUses: 0,
        },
      });
    }
    const pending = name === QUESTION_TOOL ? questionFrom(id, input) : undefined;
    if (pending !== undefined) {
      this.question = pending;
      return this.event(id, at, "question", { text: pending.text, pending });
    }
    const json = JSON.stringify(input);
    return this.event(id, at, "tool", {
      tool: {
        name,
        summary: summarizeToolInput(name, input),
        status: "running",
        ...(json !== undefined && { input: truncate(json, MAX_TOOL_TEXT) }),
      },
    });
  }

  private userLine(
    blocks: Block[],
    uuid: string | undefined,
    at: string,
    toolUseResult: unknown,
  ): ChatEvent[] {
    const events: ChatEvent[] = [];
    const text = joinText(blocks);
    if (text !== undefined && uuid !== undefined)
      events.push(this.event(uuid, at, "user", { text }));
    const results = blocks.filter((b) => b.type === "tool_result");
    // `toolUseResult` describes the line's one tool result; with several it is ambiguous.
    const agentId = results.length === 1 ? agentIdOf(toolUseResult) : undefined;
    for (const block of results) {
      if (typeof block.tool_use_id !== "string") continue;
      const done = this.toolResult(block.tool_use_id, block, agentId);
      if (done !== undefined) events.push(done);
    }
    return events;
  }

  private toolResult(id: string, block: Block, agentId: string | undefined): ChatEvent | undefined {
    const prev = this.open.get(id);
    if (prev === undefined) return undefined;
    this.open.delete(id);
    this.unlinked.delete(id);
    const failed = block.is_error === true;
    if (prev.subagent !== undefined) {
      if (agentId !== undefined) this.links.set(id, `agent-${agentId}`);
      const threadId = this.links.get(id) ?? prev.subagent.threadId;
      const status = failed ? "error" : "done";
      return { ...prev, subagent: { ...prev.subagent, threadId, status } };
    }
    if (prev.kind === "question") {
      if (this.question?.id === id) this.question = undefined;
      const answered = { ...prev };
      delete answered.pending;
      return answered;
    }
    if (prev.tool === undefined) return undefined;
    const result = resultText(block.content);
    return {
      ...prev,
      tool: {
        ...prev.tool,
        status: failed ? "error" : "ok",
        ...(result !== undefined && { result: truncate(result, MAX_TOOL_TEXT) }),
      },
    };
  }

  private event(
    id: string,
    at: string,
    kind: ChatEvent["kind"],
    fields: Partial<ChatEvent>,
  ): ChatEvent {
    return { id, threadId: this.threadId, at, kind, ...fields };
  }

  private fallbackTime(): string {
    return this.lastAt ?? new Date().toISOString();
  }
}

/** A message's content as blocks: a plain string is one text block. */
function contentBlocks(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/** The non-blank text blocks joined by a blank line, or undefined when there are none. */
function joinText(blocks: Block[]): string | undefined {
  const texts = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string" && b.text.trim() !== "")
    .map((b) => b.text as string);
  return texts.length > 0 ? texts.join("\n\n") : undefined;
}

function resultText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? (joinText(content.filter(isRecord)) ?? "") : undefined;
}

function agentIdOf(toolUseResult: unknown): string | undefined {
  if (!isRecord(toolUseResult)) return undefined;
  return typeof toolUseResult.agentId === "string" ? toolUseResult.agentId : undefined;
}

/** The pending question of an AskUserQuestion call (its first question), if well formed. */
function questionFrom(id: string, input: unknown): QuestionPending | undefined {
  if (!isRecord(input) || !Array.isArray(input.questions)) return undefined;
  const question: unknown = input.questions[0];
  if (!isRecord(question) || typeof question.question !== "string") return undefined;
  const options = Array.isArray(question.options) ? question.options.filter(isRecord) : [];
  return {
    kind: "question",
    id,
    text: question.question,
    multiSelect: question.multiSelect === true,
    allowsText: true, // Claude Code always offers a free-text "Other" answer
    options: options.flatMap(optionFrom),
  };
}

/** An option with "(Recommended)" moved from its label to the `recommended` flag. */
function optionFrom(option: Record<string, unknown>): QuestionOption[] {
  if (typeof option.label !== "string") return [];
  const recommended = RECOMMENDED.test(option.label);
  return [
    {
      label: recommended ? option.label.replace(RECOMMENDED, " ").trim() : option.label,
      ...(typeof option.description === "string" && { description: option.description }),
      ...(recommended && { recommended: true }),
    },
  ];
}
