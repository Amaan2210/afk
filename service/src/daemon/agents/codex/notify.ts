import { isRecord } from "../../../util/is-record.js";
import type { AgentSignal } from "../../sessions/state.js";

export interface CodexNotifyResult {
  signals: AgentSignal[];
  meta?: { agentSessionId?: string };
}

/**
 * Maps the JSON payload Codex passes to its `notify` program. Only `agent-turn-complete` means
 * something to us (a `turn_end`); anything else, or anything malformed, yields no signals.
 */
export function mapCodexNotify(payload: unknown): CodexNotifyResult {
  if (!isRecord(payload) || payload.type !== "agent-turn-complete") return { signals: [] };
  const last = payload["last-assistant-message"];
  const signal: AgentSignal =
    typeof last === "string" ? { kind: "turn_end", lastMessage: last } : { kind: "turn_end" };
  const threadId = payload["thread-id"];
  return typeof threadId === "string"
    ? { signals: [signal], meta: { agentSessionId: threadId } }
    : { signals: [signal] };
}
