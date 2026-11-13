import { CLAUDE_HOOK_EVENTS, renderClaudeSettings } from "../../src/launch/claude-settings.js";

describe("renderClaudeSettings", () => {
  const s = renderClaudeSettings({ nodeExe: "C:\\n\\node.exe", cliEntry: "D:\\a b\\cli.js" });

  it("registers all nine hook events with the quoted relay command", () => {
    expect(CLAUDE_HOOK_EVENTS).toHaveLength(9);
    for (const ev of CLAUDE_HOOK_EVENTS)
      expect(s.hooks[ev][0]!.hooks[0]!.command).toBe(
        `"C:\\n\\node.exe" "D:\\a b\\cli.js" hook ${ev}`,
      );
  });

  it("scopes PreToolUse and PostToolUse to AskUserQuestion", () => {
    expect(s.hooks.PreToolUse[0]!.matcher).toBe("AskUserQuestion");
    expect(s.hooks.PostToolUse[0]!.matcher).toBe("AskUserQuestion");
  });

  it("leaves every other event unscoped", () => {
    const scoped = CLAUDE_HOOK_EVENTS.filter((ev) => "matcher" in s.hooks[ev][0]!);
    expect(scoped).toEqual(["PreToolUse", "PostToolUse"]);
  });

  it("gives each relay a short timeout", () => {
    for (const ev of CLAUDE_HOOK_EVENTS)
      expect(s.hooks[ev][0]!.hooks[0]).toMatchObject({ type: "command", timeout: 10 });
  });

  it("sets the statusLine relay, run again every 3 seconds", () => {
    expect(s.statusLine).toEqual({
      type: "command",
      command: `"C:\\n\\node.exe" "D:\\a b\\cli.js" statusline`,
      padding: 0,
      refreshInterval: 3,
    });
  });
});
