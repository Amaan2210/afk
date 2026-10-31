import { CodexRolloutNormalizer } from "../../../../src/daemon/agents/codex/rollout.js";
import { readFixtureLines } from "../../../helpers/fixtures.js";

const T = "2026-10-30T12:00:00.000Z";
const item = (payload: object, ordinal = 1) => ({
  timestamp: T,
  ordinal,
  type: "response_item",
  payload,
});
const msg = (role: string, text: string, ordinal = 1) =>
  item({ type: "message", role, content: [{ type: "input_text", text }] }, ordinal);

describe("CodexRolloutNormalizer on the fixture", () => {
  const n = new CodexRolloutNormalizer();
  const out = readFixtureLines("codex/rollout.jsonl").map((l) => n.push(l));

  it("session_meta yields meta", () =>
    expect(out[0].meta).toEqual({ threadId: "thread-1", cwd: "D:\\p", model: "gpt-6-astra" }));

  it("task_started → turn_start; task_complete → turn_end with last message", () => {
    expect(out[1].signals).toEqual([{ kind: "turn_start" }]);
    expect(out[10].signals).toEqual([
      { kind: "turn_end", lastMessage: "Done. Want me to commit?" },
    ]);
  });

  it("user and assistant messages become events; developer, reasoning, agent_message are ignored", () => {
    expect(out[2].events[0]).toMatchObject({ kind: "user", text: "Add login", id: "ord-2" });
    expect(out[3].events).toEqual([]);
    expect(out[6].events).toEqual([]);
    expect(out[9].events).toEqual([]);
    expect(out[7].events[0]).toMatchObject({
      kind: "assistant",
      text: "Done. Want me to commit?",
    });
    expect(n.lastAssistantText).toBe("Done. Want me to commit?");
  });

  it("function_call and its output become a tool upsert", () => {
    expect(out[4].events[0]).toMatchObject({
      id: "c1",
      threadId: "main",
      at: "2026-10-30T12:33:13.000Z",
      kind: "tool",
      tool: { name: "shell", summary: "npm test", status: "running" },
    });
    expect(out[4].events[0].tool?.input).toBe('{"command":["npm","test"]}');
    expect(out[5].events[0]).toMatchObject({ id: "c1", tool: { status: "ok", result: "ok" } });
  });

  it("token_count yields a strip with model and context percentage", () => {
    expect(out[8].strip).toMatchObject({
      model: { id: "gpt-6-astra", name: "gpt-6-astra" },
      contextSize: 258400,
      tokensIn: 21720,
      tokensOut: 375,
    });
    expect(out[8].strip!.contextUsedPct).toBeCloseTo(8.55, 1);
  });

  it("lines without meta, signals or a strip leave those out", () => {
    expect(out[2].meta).toBeUndefined();
    expect(out[2].strip).toBeUndefined();
    expect(out[2].signals).toEqual([]);
  });
});

describe("CodexRolloutNormalizer real Codex shapes", () => {
  it("turn_context yields the model and cwd, and the model reaches later strips", () => {
    const n = new CodexRolloutNormalizer();
    const ctx = n.push({
      timestamp: T,
      ordinal: 1,
      type: "turn_context",
      payload: { turn_id: "t", cwd: "D:\\p", model: "gpt-6-astra" },
    });
    expect(ctx.meta).toEqual({ cwd: "D:\\p", model: "gpt-6-astra" });
    const usage = n.push({
      timestamp: T,
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        usage: {
          input_tokens: 21775,
          cached_input_tokens: 12416,
          output_tokens: 78,
          total_tokens: 21853,
        },
      },
    });
    expect(usage.strip).toEqual({
      at: T,
      model: { id: "gpt-6-astra", name: "gpt-6-astra" },
      tokensIn: 21775,
      tokensOut: 78,
    });
  });

  it("session_meta without a model emits no model key", () => {
    const n = new CodexRolloutNormalizer();
    const out = n.push({
      timestamp: T,
      type: "session_meta",
      payload: { id: "th", cwd: "D:\\p", cli_version: "0.166" },
    });
    expect(out.meta).toEqual({ threadId: "th", cwd: "D:\\p" });
  });

  it("remembers the context window from task_started for a token_usage_record", () => {
    const n = new CodexRolloutNormalizer();
    n.push({
      timestamp: T,
      type: "event_msg",
      payload: { type: "task_started", model_context_window: 1000 },
    });
    const out = n.push({
      timestamp: T,
      type: "token_usage_record",
      payload: { usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
    });
    expect(out.strip).toMatchObject({ contextSize: 1000, contextUsedPct: 15 });
  });

  it("accepts turn_id nested in turn_attribution on task_started", () => {
    const n = new CodexRolloutNormalizer();
    const out = n.push({
      timestamp: T,
      type: "event_msg",
      payload: { type: "task_started", turn_attribution: { turn_id: "t9" } },
    });
    expect(out.signals).toEqual([{ kind: "turn_start" }]);
  });

  it("task_complete without a last message yields turn_end without lastMessage", () => {
    const n = new CodexRolloutNormalizer();
    for (const payload of [
      { type: "task_complete", last_agent_message: null },
      { type: "task_complete" },
    ]) {
      expect(n.push({ timestamp: T, type: "event_msg", payload }).signals).toEqual([
        { kind: "turn_end" },
      ]);
    }
  });

  it("omits the percentage when the context size or total is unknown", () => {
    const n = new CodexRolloutNormalizer();
    const out = n.push({
      timestamp: T,
      type: "token_usage_record",
      payload: { usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } },
    });
    expect(out.strip).toEqual({ at: T, tokensIn: 5, tokensOut: 1 });
  });

  it("ignores unknown line types, response_item types and event_msg types", () => {
    const n = new CodexRolloutNormalizer();
    const empty = { events: [], signals: [] };
    for (const line of [
      { timestamp: T, type: "compacted", payload: { x: 1 } },
      { timestamp: T, type: "event_msg", payload: { type: "agent_reasoning", text: "hm" } },
      { timestamp: T, type: "event_msg", payload: { type: "user_message", message: "hi" } },
      item({ type: "additional_tools", tools: [] }),
      item({ type: "web_search_call" }),
      item({ type: "message" }),
      { timestamp: T, type: "response_item" },
      { type: 5 },
    ]) {
      expect(n.push(line)).toEqual(empty);
    }
  });

  it("never throws on non-record input", () => {
    const n = new CodexRolloutNormalizer();
    for (const line of [null, undefined, 3, "x", [], {}]) {
      expect(n.push(line)).toEqual({ events: [], signals: [] });
    }
  });

  it("ignores injected environment_context and user_instructions user lines", () => {
    const n = new CodexRolloutNormalizer();
    expect(n.push(msg("user", "<environment_context>\n<cwd>D:\\p</cwd>")).events).toEqual([]);
    expect(n.push(msg("user", "  <user_instructions>be nice</user_instructions>")).events).toEqual(
      [],
    );
    expect(n.push(msg("user", "real prompt", 3)).events).toHaveLength(1);
  });

  it("falls back to a line counter for ids when ordinal is absent", () => {
    const n = new CodexRolloutNormalizer();
    n.push({ timestamp: T, type: "event_msg", payload: { type: "task_started" } });
    const out = n.push({
      timestamp: T,
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "a" }] },
    });
    expect(out.events[0].id).toBe("ord-2");
  });

  it("uses the previous event's time when a line has no timestamp", () => {
    const n = new CodexRolloutNormalizer();
    n.push(msg("user", "a", 1));
    const out = n.push({
      ordinal: 2,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "b" }],
      },
    });
    expect(out.events[0].at).toBe(T);
  });

  it("uses the given thread id on events", () => {
    const n = new CodexRolloutNormalizer("agent-7");
    expect(n.push(msg("user", "a")).events[0].threadId).toBe("agent-7");
  });

  it("joins several text blocks and ignores blank messages", () => {
    const n = new CodexRolloutNormalizer();
    const out = n.push(
      item({
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "one" },
          { type: "output_text", text: "two" },
        ],
      }),
    );
    expect(out.events[0].text).toBe("one\n\ntwo");
    expect(n.push(msg("user", "   ", 4)).events).toEqual([]);
  });
});

describe("CodexRolloutNormalizer tools", () => {
  it("custom_tool_call and its output are a tool upsert", () => {
    const n = new CodexRolloutNormalizer();
    const start = n.push(
      item({
        type: "custom_tool_call",
        name: "apply_patch",
        input: "*** Begin Patch",
        call_id: "p1",
      }),
    );
    expect(start.events[0]).toMatchObject({
      id: "p1",
      kind: "tool",
      tool: { name: "apply_patch", status: "running", input: "*** Begin Patch" },
    });
    const done = n.push(
      item({ type: "custom_tool_call_output", call_id: "p1", output: "patched" }),
    );
    expect(done.events[0]).toMatchObject({
      id: "p1",
      tool: { name: "apply_patch", status: "ok", result: "patched" },
    });
  });

  it("output for an unknown call_id still yields a tool event", () => {
    const n = new CodexRolloutNormalizer();
    const out = n.push(item({ type: "function_call_output", call_id: "zz", output: "late" }));
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({
      id: "zz",
      kind: "tool",
      tool: { name: "unknown", summary: "", status: "ok", result: "late" },
    });
  });

  it("a bad arguments string does not throw and gives an empty summary", () => {
    const n = new CodexRolloutNormalizer();
    const out = n.push(
      item({ type: "function_call", name: "shell", arguments: "{oops", call_id: "b" }),
    );
    expect(out.events[0].tool).toMatchObject({ name: "shell", summary: "", input: "{oops" });
  });

  it("non-shell tools use summarizeToolInput on the parsed arguments", () => {
    const n = new CodexRolloutNormalizer();
    const out = n.push(
      item({
        type: "function_call",
        name: "Read",
        arguments: '{"file_path":"a.ts"}',
        call_id: "r",
      }),
    );
    expect(out.events[0].tool?.summary).toBe("a.ts");
  });

  it("object output uses its string content, else JSON", () => {
    const n = new CodexRolloutNormalizer();
    n.push(item({ type: "function_call", name: "shell", arguments: "{}", call_id: "o1" }));
    n.push(item({ type: "function_call", name: "shell", arguments: "{}", call_id: "o2" }));
    const withContent = n.push(
      item({
        type: "function_call_output",
        call_id: "o1",
        output: { content: "text", success: true },
      }),
    );
    expect(withContent.events[0].tool).toMatchObject({ status: "ok", result: "text" });
    const without = n.push(
      item({ type: "function_call_output", call_id: "o2", output: { lines: [1] } }),
    );
    expect(without.events[0].tool?.result).toBe('{"lines":[1]}');
  });

  it("marks error only for success:false or a non-zero exit_code", () => {
    const n = new CodexRolloutNormalizer();
    for (const id of ["e1", "e2", "e3"]) {
      n.push(item({ type: "function_call", name: "shell", arguments: "{}", call_id: id }));
    }
    const status = (id: string, output: unknown) =>
      n.push(item({ type: "function_call_output", call_id: id, output })).events[0].tool?.status;
    expect(status("e1", { content: "x", success: false })).toBe("error");
    expect(status("e2", { content: "x", exit_code: 2 })).toBe("error");
    expect(status("e3", "Error: command failed")).toBe("ok");
  });

  it("truncates long input and result to 4000 characters plus an ellipsis", () => {
    const n = new CodexRolloutNormalizer();
    const args = JSON.stringify({ command: ["x".repeat(5000)] });
    const start = n.push(
      item({ type: "function_call", name: "shell", arguments: args, call_id: "L" }),
    );
    expect(start.events[0].tool?.input).toHaveLength(4001);
    expect(start.events[0].tool?.summary.length).toBeLessThanOrEqual(121);
    const done = n.push(
      item({ type: "function_call_output", call_id: "L", output: "y".repeat(5000) }),
    );
    expect(done.events[0].tool?.result).toHaveLength(4001);
  });

  it("returns fresh objects: an earlier event is not changed by its result", () => {
    const n = new CodexRolloutNormalizer();
    const start = n.push(
      item({ type: "function_call", name: "shell", arguments: "{}", call_id: "f" }),
    );
    n.push(item({ type: "function_call_output", call_id: "f", output: "done" }));
    expect(start.events[0].tool?.status).toBe("running");
  });
});
