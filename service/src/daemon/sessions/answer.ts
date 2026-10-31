import type { Pending, SessionKind } from "../../protocol/index.js";

export interface Answer {
  choiceIndices?: number[];
  text?: string;
  decision?: "allow" | "allow_always" | "deny";
}

type Decision = NonNullable<Answer["decision"]>;
type Question = Extract<Pending, { kind: "question" }>;

const DOWN = "\x1b[B";
const ESC = "\x1b";

/**
 * How to drive one agent's prompt. Each builder returns *chunks*: byte groups that must be typed
 * one after another with a short pause (the caller waits for a re-render between chunks), because
 * a TUI that changes mode on a key drops keys that arrive in the same write.
 */
interface PromptKeys {
  /** Single-select: choose option `index` (0-based). */
  single: (index: number, q: Question) => string[];
  /** Multi-select: toggle the ascending `indices` and submit. */
  multi: (indices: number[], q: Question) => string[];
  /** Free text. */
  text: (text: string, q: Question) => string[];
  permission: Record<Decision, string>;
}

/** Digit keys address options 1-9 only. */
const MAX_DIGIT_OPTIONS = 9;

function digit(index: number): string {
  if (index >= MAX_DIGIT_OPTIONS)
    throw badRequest(`option ${index + 1} cannot be addressed by digit`);
  return String(index + 1);
}

/**
 * Claude Code AskUserQuestion, as probed against 2.1.316 on Windows (docs/notes/prompt-keystrokes.md):
 * - single-select: the digit alone selects AND submits (no Enter; a trailing Enter lands on the composer).
 * - free text: the row after the last option is "Type something"; its digit focuses it, then the
 *   text and Enter. The digit must be a separate chunk or the text is lost and option 1 is chosen.
 * - multi-select: digits do NOT toggle; Down moves, Space toggles, Enter on the Submit row (the row
 *   after "Type something") opens a review screen, whose default "Submit answers" Enter confirms
 *   (that last Enter is UNVERIFIED).
 * - permission: "1" yes, "2" yes-always, no Enter. "No" is "3" normally but "4" when the
 *   switch-to-auto-mode option is offered (and "3" would then change the mode), so deny is Esc.
 */
const CLAUDE_QUESTIONS = {
  single: (i: number) => [digit(i)],
  multi: (indices: number[], q: Question) => {
    let cursor = 0;
    let nav = "";
    for (const i of indices) {
      nav += DOWN.repeat(i - cursor) + " ";
      cursor = i;
    }
    const submitRow = q.options.length + 1;
    return [nav + DOWN.repeat(submitRow - cursor) + "\r", "\r"];
  },
  text: (text: string, q: Question) => [digit(q.options.length), text + "\r"],
};

/**
 * Keystrokes per agent. Codex is UNVERIFIED: the probe stopped at Codex's login screen (no
 * session available), so its question keys mirror Claude's and its approval keys are the
 * documented y/a/n.
 */
const KEYSTROKES: Record<Exclude<SessionKind, "shell">, PromptKeys> = {
  claude: {
    ...CLAUDE_QUESTIONS,
    permission: { allow: "1", allow_always: "2", deny: ESC },
  },
  codex: {
    ...CLAUDE_QUESTIONS,
    permission: { allow: "y", allow_always: "a", deny: "n" },
  },
};

function badRequest(message: string): Error {
  return new Error(`bad_request: ${message}`);
}

function questionChunks(keys: PromptKeys, q: Question, a: Answer): string[] {
  if (a.decision !== undefined) throw badRequest("decision is only valid for a permission prompt");
  if ((a.choiceIndices === undefined) === (a.text === undefined)) {
    throw badRequest("give exactly one of choiceIndices or text");
  }
  if (a.text !== undefined) {
    if (!q.allowsText) throw badRequest("this question does not accept free text");
    return keys.text(a.text, q);
  }
  const picks = a.choiceIndices ?? [];
  if (picks.length === 0) throw badRequest("choiceIndices must not be empty");
  if (!q.multiSelect && picks.length > 1) throw badRequest("this question accepts a single choice");
  if (new Set(picks).size !== picks.length) throw badRequest("duplicate choice index");
  for (const i of picks) {
    if (!Number.isInteger(i) || i < 0 || i >= q.options.length) {
      throw badRequest(`choice ${i} out of range`);
    }
  }
  const sorted = [...picks].sort((x, y) => x - y);
  return q.multiSelect ? keys.multi(sorted, q) : keys.single(sorted[0] ?? 0, q);
}

function permissionChunks(keys: PromptKeys, a: Answer): string[] {
  if (a.choiceIndices !== undefined || a.text !== undefined) {
    throw badRequest("a permission prompt takes only a decision");
  }
  if (a.decision === undefined) throw badRequest("decision is required for a permission prompt");
  const out = keys.permission[a.decision] as string | undefined;
  if (out === undefined) throw badRequest(`unknown decision ${String(a.decision)}`);
  return [out];
}

/**
 * The answer as chunks to type into the agent's PTY in order, pausing for a re-render between
 * chunks. Throws `bad_request:` errors for invalid combinations.
 */
export function chunksForAnswer(kind: SessionKind, pending: Pending, a: Answer): Buffer[] {
  if (kind === "shell") throw badRequest("shell sessions have no prompts");
  const keys = KEYSTROKES[kind];
  const chunks =
    pending.kind === "question" ? questionChunks(keys, pending, a) : permissionChunks(keys, a);
  return chunks.map((c) => Buffer.from(c, "utf8"));
}

/** All of the answer's keystrokes as one buffer (chunk boundaries lost; see `chunksForAnswer`). */
export function keystrokesForAnswer(kind: SessionKind, pending: Pending, a: Answer): Buffer {
  return Buffer.concat(chunksForAnswer(kind, pending, a));
}
