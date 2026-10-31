export interface ClaudeHookTarget {
  nodeExe: string;
  cliEntry: string;
}

export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
] as const;

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

interface CommandHook {
  type: "command";
  command: string;
  timeout: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: CommandHook[];
}

export interface ClaudeSettings {
  hooks: Record<ClaudeHookEvent, HookMatcher[]>;
  statusLine: { type: "command"; command: string; padding: number };
}

/** Tool hooks only need the question tool; every other tool call stays unhooked. */
const MATCHERS: Partial<Record<ClaudeHookEvent, string>> = {
  PreToolUse: "AskUserQuestion",
  PostToolUse: "AskUserQuestion",
};

/** Seconds. The relay itself gives up on the daemon well inside this. */
const HOOK_TIMEOUT = 10;

/** Absolute node + absolute script, both quoted, so neither PATH nor spaces matter. */
function relayCommand(t: ClaudeHookTarget, ...args: string[]): string {
  return [`"${t.nodeExe}"`, `"${t.cliEntry}"`, ...args].join(" ");
}

/**
 * The settings passed to Claude Code with `--settings` for one session: every hook event and
 * the status line relay to `afk`. The user's own settings file is never read or written here.
 */
export function renderClaudeSettings(t: ClaudeHookTarget): ClaudeSettings {
  const hooks = {} as Record<ClaudeHookEvent, HookMatcher[]>;
  for (const event of CLAUDE_HOOK_EVENTS) {
    const matcher = MATCHERS[event];
    const hook: CommandHook = {
      type: "command",
      command: relayCommand(t, "hook", event),
      timeout: HOOK_TIMEOUT,
    };
    hooks[event] = [matcher ? { matcher, hooks: [hook] } : { hooks: [hook] }];
  }
  return {
    hooks,
    statusLine: { type: "command", command: relayCommand(t, "statusline"), padding: 0 },
  };
}
