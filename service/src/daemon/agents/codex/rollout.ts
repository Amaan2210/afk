import type { ChatEvent, Strip } from "../../../protocol/index.js";
import { isRecord } from "../../../util/is-record.js";
import type { AgentSignal } from "../../sessions/state.js";
import { truncate } from "../summarize.js";
import { describeArgs, failed, isNumber, joinText, outputText } from "./rollout-parts.js";

/** Longest tool input or result carried in a chat event. */
const MAX_TOOL_TEXT = 4000;
const UNKNOWN_TOOL = "unknown";
/** Codex injects these as user-role messages; they are not something the user typed. */
const INJECTED_PREFIXES = ["<environment_context>", "<user_instructions>"];

export interface RolloutMeta {
  threadId?: string;
  cwd?: string;
  model?: string;
}

export interface RolloutResult {
  events: ChatEvent[];
  signals: AgentSignal[];
  strip?: Strip;
  meta?: RolloutMeta;
}

type Record_ = Record<string, unknown>;

/**
 * Turns the lines of one Codex rollout file into chat events, signals, a status strip and session
 * meta. Only the line and payload types handled below produce output; every other one, known or
 * not, is ignored and nothing here throws. Message events take `ord-<ordinal>` as id; tool events
 * take the call_id and are emitted again with the same id (an upsert) when the output arrives.
 * Every event returned is a fresh object that is never changed afterwards.
 */
export class CodexRolloutNormalizer {
  /** Latest event of each tool call still waiting for its output. */
  private readonly open = new Map<string, ChatEvent>();
  private lines = 0;
  private lastAt: string | undefined;
  private lastText: string | undefined;
  private model: string | undefined;
  private contextSize: number | undefined;

  constructor(private readonly threadId: string = "main") {}

  /** Text of the latest assistant message. */
  get lastAssistantText(): string | undefined {
    return this.lastText;
  }

  push(line: unknown): RolloutResult {
    const out: RolloutResult = { events: [], signals: [] };
    this.lines += 1;
    if (!isRecord(line) || !isRecord(line.payload)) return out;
    const at = typeof line.timestamp === "string" ? line.timestamp : this.fallbackTime();
    this.lastAt = at;
    const payload = line.payload;
    switch (line.type) {
      case "session_meta":
        this.sessionMeta(payload, out);
        break;
      case "turn_context":
        this.turnContext(payload, out);
        break;
      case "event_msg":
        this.eventMsg(payload, at, out);
        break;
      case "token_usage_record":
        this.recordUsage(payload.usage, at, out);
        break;
      case "response_item":
        this.responseItem(payload, line.ordinal, at, out);
        break;
      default:
        break;
    }
    return out;
  }

  private sessionMeta(payload: Record_, out: RolloutResult): void {
    const meta: RolloutMeta = {};
    if (typeof payload.id === "string") meta.threadId = payload.id;
    if (typeof payload.cwd === "string") meta.cwd = payload.cwd;
    if (typeof payload.model === "string") {
      meta.model = payload.model;
      this.model = payload.model;
    }
    if (Object.keys(meta).length > 0) out.meta = meta;
  }

  private turnContext(payload: Record_, out: RolloutResult): void {
    const meta: RolloutMeta = {};
    if (typeof payload.cwd === "string") meta.cwd = payload.cwd;
    if (typeof payload.model === "string") {
      meta.model = payload.model;
      this.model = payload.model;
    }
    if (Object.keys(meta).length > 0) out.meta = meta;
  }

  private eventMsg(payload: Record_, at: string, out: RolloutResult): void {
    switch (payload.type) {
      case "task_started":
        this.rememberContextSize(payload.model_context_window);
        out.signals.push({ kind: "turn_start" });
        break;
      // The user interrupted the turn (Ctrl+C or Esc): no task_complete follows.
      case "turn_aborted":
        out.signals.push({ kind: "turn_abort" });
        break;
      case "task_complete": {
        const last = payload.last_agent_message;
        out.signals.push(
          typeof last === "string" ? { kind: "turn_end", lastMessage: last } : { kind: "turn_end" },
        );
        break;
      }
      case "token_count": {
        if (!isRecord(payload.info)) break;
        this.rememberContextSize(payload.info.model_context_window);
        this.recordUsage(payload.info.total_token_usage, at, out);
        break;
      }
      default:
        break;
    }
  }

  private rememberContextSize(value: unknown): void {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) this.contextSize = value;
  }

  /** A strip from a usage object (`input_tokens`, `output_tokens`, `total_tokens`). */
  private recordUsage(usage: unknown, at: string, out: RolloutResult): void {
    if (!isRecord(usage)) return;
    const strip: Strip = { at };
    if (this.model !== undefined) strip.model = { id: this.model, name: this.model };
    if (this.contextSize !== undefined) strip.contextSize = this.contextSize;
    if (isNumber(usage.input_tokens)) strip.tokensIn = usage.input_tokens;
    if (isNumber(usage.output_tokens)) strip.tokensOut = usage.output_tokens;
    if (this.contextSize !== undefined && isNumber(usage.total_tokens)) {
      strip.contextUsedPct = Math.min(100, (usage.total_tokens / this.contextSize) * 100);
    }
    out.strip = strip;
  }

  private responseItem(payload: Record_, ordinal: unknown, at: string, out: RolloutResult): void {
    switch (payload.type) {
      case "message":
        this.message(payload, ordinal, at, out);
        break;
      case "function_call":
        this.toolStart(payload.name, payload.arguments, payload.call_id, at, out);
        break;
      case "custom_tool_call":
        this.toolStart(payload.name, payload.input, payload.call_id, at, out);
        break;
      case "function_call_output":
      case "custom_tool_call_output":
        this.toolOutput(payload.call_id, payload.output, at, out);
        break;
      default:
        break;
    }
  }

  private message(payload: Record_, ordinal: unknown, at: string, out: RolloutResult): void {
    if (payload.role !== "user" && payload.role !== "assistant") return;
    const text = joinText(payload.content);
    if (text === undefined) return;
    if (payload.role === "user") {
      const head = text.trimStart();
      if (INJECTED_PREFIXES.some((prefix) => head.startsWith(prefix))) return;
    } else {
      this.lastText = text;
    }
    const id = `ord-${typeof ordinal === "number" ? ordinal : this.lines}`;
    out.events.push(this.event(id, at, payload.role, { text }));
  }

  private toolStart(
    name: unknown,
    args: unknown,
    id: unknown,
    at: string,
    out: RolloutResult,
  ): void {
    if (typeof name !== "string" || typeof id !== "string") return;
    const { summary, raw } = describeArgs(name, args);
    const event = this.event(id, at, "tool", {
      tool: {
        name,
        summary,
        status: "running",
        ...(raw !== undefined && { input: truncate(raw, MAX_TOOL_TEXT) }),
      },
    });
    this.open.set(id, event);
    out.events.push(event);
  }

  private toolOutput(id: unknown, output: unknown, at: string, out: RolloutResult): void {
    if (typeof id !== "string") return;
    const prev =
      this.open.get(id) ??
      this.event(id, at, "tool", { tool: { name: UNKNOWN_TOOL, summary: "", status: "running" } });
    if (prev.tool === undefined) return;
    this.open.delete(id);
    const result = outputText(output);
    const done: ChatEvent = {
      ...prev,
      tool: {
        ...prev.tool,
        status: failed(output) ? "error" : "ok",
        ...(result !== undefined && { result: truncate(result, MAX_TOOL_TEXT) }),
      },
    };
    out.events.push(done);
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
