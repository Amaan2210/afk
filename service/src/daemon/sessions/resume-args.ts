import type { SessionKind } from "../../protocol/index.js";

/** Claude options that pick the conversation to continue: `--resume [id]` and `--continue`. */
const CLAUDE_RESUME = new Set(["--resume", "-r"]);
const CLAUDE_CONTINUE = new Set(["--continue", "-c"]);

/**
 * `args` without the options that already choose a conversation, so a resume can append its own:
 * Claude's `--resume`/`-r` (with its id, when the next argument is not an option), `--resume=<id>`
 * and `--continue`/`-c`; Codex's `resume` subcommand and everything after it. For Codex, `-c` is a
 * config override and stays. Claude's arguments after a bare `--` are the prompt and stay too.
 */
export function withoutResumeArgs(kind: SessionKind, args: readonly string[]): string[] {
  if (kind === "codex") {
    const at = args.indexOf("resume");
    return at === -1 ? [...args] : args.slice(0, at);
  }
  if (kind !== "claude") return [...args];
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      kept.push(...args.slice(i));
      break;
    }
    if (CLAUDE_CONTINUE.has(arg) || arg.startsWith("--resume=")) continue;
    if (CLAUDE_RESUME.has(arg)) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) i++;
      continue;
    }
    kept.push(arg);
  }
  return kept;
}
