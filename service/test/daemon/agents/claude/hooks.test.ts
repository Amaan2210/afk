import {
  mapClaudeHook,
  pendingFromAskUserQuestion,
} from "../../../../src/daemon/agents/claude/hooks.js";
import { readFixtureJson } from "../../../helpers/fixtures.js";

const fx = (name: string): unknown => readFixtureJson(`claude/hooks/${name}.json`);

describe("mapClaudeHook", () => {
  it("SessionStart yields meta only", () =>
    expect(mapClaudeHook("SessionStart", fx("SessionStart"))).toEqual({
      signals: [],
      meta: {
        agentSessionId: "sess-1",
        transcriptPath: "C:\\u\\.claude\\projects\\D--p\\sess-1.jsonl",
        cwd: "D:\\p",
      },
    }));

  it("UserPromptSubmit → turn_start", () =>
    expect(mapClaudeHook("UserPromptSubmit", fx("UserPromptSubmit")).signals).toEqual([
      { kind: "turn_start" },
    ]));

  it("PreToolUse AskUserQuestion → pending question", () => {
    const [s] = mapClaudeHook("PreToolUse", fx("PreToolUse")).signals;
    expect(s).toMatchObject({
      kind: "pending",
      pending: {
        kind: "question",
        id: "toolu_3",
        options: [
          { label: "Session cookies", recommended: true, description: "Matches" },
          { label: "JWT" },
        ],
      },
    });
  });

  it("PreToolUse for another tool → nothing", () =>
    expect(
      mapClaudeHook("PreToolUse", { tool_name: "Bash", tool_use_id: "t", tool_input: {} }),
    ).toEqual({ signals: [] }));

  it("PostToolUse AskUserQuestion → pending_cleared with the id", () =>
    expect(mapClaudeHook("PostToolUse", fx("PostToolUse")).signals).toEqual([
      { kind: "pending_cleared", pendingId: "toolu_3" },
    ]));

  it("Notification permission_prompt → pending permission; idle_prompt → nothing", () => {
    expect(mapClaudeHook("Notification", fx("Notification.permission")).signals[0]).toMatchObject({
      kind: "pending",
      pending: {
        kind: "permission",
        tool: "Bash",
        summary: "Claude needs your permission to use Bash",
      },
    });
    expect(mapClaudeHook("Notification", fx("Notification.idle")).signals).toEqual([]);
  });

  it("permission pendings get unique perm- ids and fall back to tool unknown", () => {
    const prompt = (message: string) =>
      mapClaudeHook("Notification", { notification_type: "permission_prompt", message }).signals[0];
    const a = prompt("Claude needs your permission to use Edit.");
    const b = prompt("Allow this?");
    expect(a).toMatchObject({ pending: { tool: "Edit" } });
    expect(b).toMatchObject({ pending: { tool: "unknown", summary: "Allow this?" } });
    const ids = [a, b].map((s) => (s?.kind === "pending" ? s.pending.id : ""));
    expect(ids[0]).toMatch(/^perm-\d+$/);
    expect(ids[1]).toMatch(/^perm-\d+$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("Stop → turn_end; SubagentStart/Stop → counters", () => {
    expect(mapClaudeHook("Stop", fx("Stop")).signals).toEqual([{ kind: "turn_end" }]);
    expect(mapClaudeHook("SubagentStart", fx("SubagentStart")).signals).toEqual([
      { kind: "subagent_start" },
    ]);
    expect(mapClaudeHook("SubagentStop", fx("SubagentStop")).signals).toEqual([
      { kind: "subagent_stop" },
    ]);
  });

  it("unknown event or garbage payload → no signals, no throw", () => {
    expect(mapClaudeHook("Whatever", {})).toEqual({ signals: [] });
    expect(mapClaudeHook("Stop", "not json")).toEqual({ signals: [] });
  });
});

describe("pendingFromAskUserQuestion", () => {
  it("builds the pending from a tool input and rejects malformed ones", () => {
    expect(pendingFromAskUserQuestion("t1", { questions: [{ question: "Q?" }] })).toMatchObject({
      kind: "question",
      id: "t1",
      text: "Q?",
    });
    expect(pendingFromAskUserQuestion("t1", null)).toBeUndefined();
  });
});
