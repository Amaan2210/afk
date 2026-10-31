import type { Pending } from "../../../protocol/index.js";
import { isRecord } from "../../../util/is-record.js";
import type { ClaudeHookEvent } from "../../../launch/claude-settings.js";
import type { AgentSignal } from "../../sessions/state.js";
import { questionFromAskUserInput } from "./question.js";

export type { ClaudeHookEvent };

export interface HookMapping {
  signals: AgentSignal[];
  meta?: { agentSessionId?: string; transcriptPath?: string; cwd?: string };
}

const QUESTION_TOOL = "AskUserQuestion";
const USED_TOOL = /use (\S+)/i;

/** Permission ids are unique within one daemon run. */
let permissionCounter = 0;

/**
 * Maps one Claude Code hook payload to the signals (and, for SessionStart, the session meta) it
 * implies. An unknown event, an event with no signal, or a malformed payload maps to no
 * signals; this never throws.
 */
export function mapClaudeHook(event: string, payload: unknown): HookMapping {
  if (!isRecord(payload)) return { signals: [] };
  switch (event as ClaudeHookEvent) {
    case "SessionStart":
      return { signals: [], meta: sessionMeta(payload) };
    case "UserPromptSubmit":
      return { signals: [{ kind: "turn_start" }] };
    case "PreToolUse":
      return { signals: preToolUse(payload) };
    case "PostToolUse":
      return { signals: postToolUse(payload) };
    case "Notification":
      return { signals: notification(payload) };
    case "Stop":
      return { signals: [{ kind: "turn_end" }] };
    case "SubagentStart":
      return { signals: [{ kind: "subagent_start" }] };
    case "SubagentStop":
      return { signals: [{ kind: "subagent_stop" }] };
    default:
      return { signals: [] };
  }
}

/** The pending question of an AskUserQuestion tool input, if well formed. */
export function pendingFromAskUserQuestion(
  toolUseId: string,
  toolInput: unknown,
): Pending | undefined {
  return questionFromAskUserInput(toolUseId, toolInput);
}

function sessionMeta(payload: Record<string, unknown>): NonNullable<HookMapping["meta"]> {
  return {
    ...(typeof payload.session_id === "string" && { agentSessionId: payload.session_id }),
    ...(typeof payload.transcript_path === "string" && {
      transcriptPath: payload.transcript_path,
    }),
    ...(typeof payload.cwd === "string" && { cwd: payload.cwd }),
  };
}

function preToolUse(payload: Record<string, unknown>): AgentSignal[] {
  if (payload.tool_name !== QUESTION_TOOL || typeof payload.tool_use_id !== "string") return [];
  const pending = pendingFromAskUserQuestion(payload.tool_use_id, payload.tool_input);
  return pending === undefined ? [] : [{ kind: "pending", pending }];
}

function postToolUse(payload: Record<string, unknown>): AgentSignal[] {
  if (payload.tool_name !== QUESTION_TOOL || typeof payload.tool_use_id !== "string") return [];
  return [{ kind: "pending_cleared", pendingId: payload.tool_use_id }];
}

function notification(payload: Record<string, unknown>): AgentSignal[] {
  if (payload.notification_type !== "permission_prompt") return [];
  const message = typeof payload.message === "string" ? payload.message : "";
  const tool = USED_TOOL.exec(message)?.[1]?.replace(/[.,;:!?]+$/, "") || "unknown";
  permissionCounter += 1;
  return [
    {
      kind: "pending",
      pending: { kind: "permission", id: `perm-${permissionCounter}`, tool, summary: message },
    },
  ];
}
