import type { Pending, SessionState } from "../../protocol/index.js";

export type AgentSignal =
  | { kind: "turn_start" }
  | { kind: "turn_end"; lastMessage?: string }
  | { kind: "pending"; pending: Pending }
  | { kind: "pending_cleared"; pendingId?: string }
  | { kind: "subagent_start" }
  | { kind: "subagent_stop" }
  /** Keystrokes from a client (the laptop window or the phone). */
  | { kind: "user_input" }
  /** The user interrupted the turn (Esc or Ctrl+C); no Stop hook or turn end follows. */
  | { kind: "turn_abort" }
  | { kind: "process_exit"; exitCode: number }
  /** The agent inside the session's shell exited; the shell lives on. */
  | { kind: "agent_exit" };

export type NotifyKind = "needs_input" | "finished" | "subagent_finished";

export interface StateSlice {
  state: SessionState;
  pending?: Pending;
  subagentsRunning: number;
  lastMessage?: string;
  exitCode?: number;
}

export interface ReduceResult {
  slice: StateSlice;
  notify?: NotifyKind;
}

export const initialSlice: StateSlice = { state: "idle", subagentsRunning: 0 };

function withoutPending(slice: StateSlice): StateSlice {
  const next = { ...slice };
  delete next.pending;
  return next;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled signal: ${JSON.stringify(value)}`);
}

/** Pure transition function: never mutates `slice` and performs no I/O. */
export function reduce(slice: StateSlice, signal: AgentSignal): ReduceResult {
  if (slice.state === "ended") return { slice: { ...slice } };

  switch (signal.kind) {
    case "turn_start":
      return { slice: { ...withoutPending(slice), state: "working" } };

    case "turn_end": {
      if (slice.subagentsRunning > 0) return { slice: { ...slice } };
      // Codex reports a turn's end twice (rollout and notify): the second only refreshes the text.
      if (slice.state === "finished") {
        const same = { ...slice };
        if (signal.lastMessage !== undefined) same.lastMessage = signal.lastMessage;
        return { slice: same };
      }
      const next = { ...withoutPending(slice), state: "finished" as const };
      if (signal.lastMessage !== undefined) next.lastMessage = signal.lastMessage;
      return { slice: next, notify: "finished" };
    }

    case "pending":
      if (signal.pending.id === slice.pending?.id) return { slice: { ...slice } };
      return {
        slice: { ...slice, state: "needs_input", pending: signal.pending },
        notify: "needs_input",
      };

    case "pending_cleared": {
      if (!slice.pending) return { slice: { ...slice } };
      if (signal.pendingId !== undefined && signal.pendingId !== slice.pending.id) {
        return { slice: { ...slice } };
      }
      const next = withoutPending(slice);
      if (next.state === "needs_input") next.state = "working";
      return { slice: next };
    }

    case "subagent_start":
      return { slice: { ...slice, subagentsRunning: slice.subagentsRunning + 1 } };

    case "subagent_stop":
      if (slice.subagentsRunning === 0) return { slice: { ...slice } };
      return {
        slice: { ...slice, subagentsRunning: slice.subagentsRunning - 1 },
        notify: "subagent_finished",
      };

    case "user_input":
      // A key at a permission prompt answers it; nothing else reports that it closed. A question
      // stays pending until its tool result (PostToolUse) arrives.
      if (slice.pending?.kind === "permission") {
        return { slice: { ...withoutPending(slice), state: "working" } };
      }
      return { slice: slice.state === "finished" ? { ...slice, state: "idle" } : { ...slice } };

    case "turn_abort":
      return { slice: { ...withoutPending(slice), state: "idle", subagentsRunning: 0 } };

    case "process_exit":
      return { slice: { ...withoutPending(slice), state: "ended", exitCode: signal.exitCode } };

    case "agent_exit":
      return { slice: { ...withoutPending(slice), state: "idle", subagentsRunning: 0 } };

    default:
      return assertNever(signal);
  }
}
