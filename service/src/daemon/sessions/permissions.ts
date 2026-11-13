import type { SessionKind } from "../../protocol/index.js";

/** Claude Code's permission mode that asks for nothing. */
export const CLAUDE_BYPASS_MODE = "bypassPermissions";

const CLAUDE_SKIP = "--dangerously-skip-permissions";
const CLAUDE_MODE = "--permission-mode";
const CODEX_SKIP = ["--dangerously-bypass-approvals-and-sandbox", "--yolo"];

/**
 * Whether an agent launched with `args` runs without asking permission: Claude Code with
 * `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`, Codex with
 * `--dangerously-bypass-approvals-and-sandbox` (or its `--yolo`). Arguments after `--` are the
 * prompt, not flags.
 */
export function skipsPermissions(kind: SessionKind, args: readonly string[]): boolean {
  const end = args.indexOf("--");
  const flags = end === -1 ? args : args.slice(0, end);
  if (kind === "codex") return flags.some((a) => CODEX_SKIP.includes(a));
  if (kind !== "claude") return false;
  return flags.some(
    (a, i) =>
      a === CLAUDE_SKIP ||
      a === `${CLAUDE_MODE}=${CLAUDE_BYPASS_MODE}` ||
      (a === CLAUDE_MODE && flags[i + 1] === CLAUDE_BYPASS_MODE),
  );
}
