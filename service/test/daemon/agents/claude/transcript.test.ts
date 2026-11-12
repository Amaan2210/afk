import {
  ClaudeTranscriptNormalizer,
  typedByUser,
} from "../../../../src/daemon/agents/claude/transcript.js";
import type { ChatEvent } from "../../../../src/protocol/index.js";
import { readFixtureLines } from "../../../helpers/fixtures.js";

const T = "2026-10-31T10:00:00.000Z";

const assistant = (uuid: string, content: unknown, extra: object = {}) => ({
  type: "assistant",
  uuid,
  timestamp: T,
  message: { role: "assistant", content },
  ...extra,
});
const user = (uuid: string, content: unknown, extra: object = {}) => ({
  type: "user",
  uuid,
  timestamp: T,
  message: { role: "user", content },
  ...extra,
});
const toolUse = (id: string, name: string, input: unknown) => ({
  type: "tool_use",
  id,
  name,
  input,
});
const agentUse = (id: string) =>
  toolUse(id, "Agent", { subagent_type: "Explore", description: `task ${id}`, prompt: "p" });
const result = (id: string, content: unknown, extra: object = {}) => ({
  type: "tool_result",
  tool_use_id: id,
  content,
  ...extra,
});

const lines = readFixtureLines("claude/main.jsonl");
const n = new ClaudeTranscriptNormalizer("main");
const events = lines.flatMap((l) => n.push(l));

describe("ClaudeTranscriptNormalizer on the main fixture", () => {
  it("ignores meta and api-request lines", () => {
    expect(events.filter((e) => e.id.startsWith("toolu_1")).length).toBe(2);
  }); // running + ok, not a third from line 10

  it("ignores an api-request-blob line even while its tool_use is still open", () => {
    const m = new ClaudeTranscriptNormalizer("main");
    for (const l of lines.slice(0, 5)) m.push(l); // toolu_1 is running
    expect(lines[9]).toMatchObject({ type: "api-request-blob" });
    expect(m.push(lines[9])).toEqual([]);
    expect(m.push(lines[0])).toEqual([]);
    expect(m.push(lines[1])).toEqual([]);
    // The real result still upserts, proving toolu_1 was open when line 10 arrived.
    expect(m.push(lines[5])).toMatchObject([{ id: "toolu_1", tool: { status: "ok" } }]);
  });

  it("emits user and assistant text", () => {
    expect(events[0]).toMatchObject({
      kind: "user",
      threadId: "main",
      text: "Add login to the API",
      at: "2026-10-30T13:35:00.000Z",
      id: "u1",
    });
    expect(events[1]).toMatchObject({
      kind: "assistant",
      text: "I'll check how sessions are handled today.",
      id: "a1",
    });
  });

  it("emits Grep running then ok with the result", () => {
    const [run, ok] = events.filter((e) => e.id === "toolu_1");
    expect(run.tool).toEqual({
      name: "Grep",
      summary: "session in src/",
      status: "running",
      input: JSON.stringify({ pattern: "session", path: "src/" }),
    });
    expect(ok.tool).toMatchObject({ status: "ok", result: "Found 14 matches in 6 files" });
  });

  it("emits a subagent event linked to agent-abc123 and marks it done on result", () => {
    const [start, done] = events.filter((e) => e.id === "toolu_2");
    expect(start).toMatchObject({
      kind: "subagent",
      subagent: {
        name: "Explore",
        task: "find existing auth code",
        status: "running",
        toolUses: 0,
      },
    });
    expect(done.subagent).toMatchObject({ status: "done", threadId: "agent-abc123" });
    expect(n.subagentLinks.get("toolu_2")).toBe("agent-abc123");
  });

  it("emits a question with recommended flag parsed from the label", () => {
    const q = events.find((e) => e.id === "toolu_3")!;
    expect(q.kind).toBe("question");
    expect(q.pending).toEqual({
      kind: "question",
      id: "toolu_3",
      text: "Which auth approach should I use?",
      multiSelect: false,
      allowsText: true,
      options: [
        { label: "Session cookies", description: "Matches the existing app", recommended: true },
        { label: "JWT in Authorization header", description: "Stateless" },
      ],
    });
    expect(n.pendingQuestion?.id).toBe("toolu_3");
  });

  it("marks a tool error from is_error and tracks lastAssistantText", () => {
    expect(events.filter((e) => e.id === "toolu_4").at(-1)!.tool!.status).toBe("error");
    expect(n.lastAssistantText).toBe("I'll check how sessions are handled today.");
  });

  it("produces 9 events over 6 ids, never a user event for a tool_result-only line", () => {
    expect(events.map((e) => e.id)).toEqual([
      "u1",
      "a1",
      "toolu_1",
      "toolu_1",
      "toolu_2",
      "toolu_2",
      "toolu_3",
      "toolu_4",
      "toolu_4",
    ]);
    expect(events.every((e) => e.threadId === "main")).toBe(true);
  });
});

describe("live sub-agent linking (ruling 1)", () => {
  /** A normaliser fed up to the Agent tool_use on line 7, so toolu_2 is running. */
  const upToAgent = () => {
    const m = new ClaudeTranscriptNormalizer("main");
    const ev = lines.slice(0, 7).flatMap((l) => m.push(l));
    return { m, ev };
  };

  it("threads a running sub-agent on its tool_use id until it is linked", () => {
    const { m, ev } = upToAgent();
    expect(ev.at(-1)).toMatchObject({
      id: "toolu_2",
      kind: "subagent",
      subagent: { threadId: "toolu_2", status: "running" },
    });
    expect(m.subagentLinks.has("toolu_2")).toBe(false);
  });

  it("linkSubagentByParent links the Agent call whose assistant line has that uuid", () => {
    const { m } = upToAgent();
    expect(m.linkSubagentByParent("a2", "agent-abc123")).toBeUndefined(); // a2 holds a Grep
    expect(m.linkSubagentByParent("a3", "agent-abc123")).toMatchObject({
      id: "toolu_2",
      kind: "subagent",
      subagent: { threadId: "agent-abc123", status: "running", name: "Explore" },
    });
    expect(m.subagentLinks.get("toolu_2")).toBe("agent-abc123");
    expect(m.linkSubagentByParent("a3", "agent-other")).toBeUndefined(); // already linked
    const [done] = m.push(lines[7]);
    expect(done.subagent).toMatchObject({ status: "done", threadId: "agent-abc123" });
  });

  it("linkNextSubagent links the oldest unlinked running Agent call", () => {
    const m = new ClaudeTranscriptNormalizer("main");
    m.push(assistant("x1", [agentUse("toolu_a")]));
    m.push(assistant("x2", [agentUse("toolu_b")]));
    expect(m.linkSubagentByParent("x2", "agent-2")).toMatchObject({ id: "toolu_b" });
    expect(m.linkNextSubagent("agent-1")).toMatchObject({
      id: "toolu_a",
      subagent: { threadId: "agent-1", status: "running" },
    });
    expect(m.linkNextSubagent("agent-3")).toBeUndefined();
    expect([...m.subagentLinks]).toEqual([
      ["toolu_b", "agent-2"],
      ["toolu_a", "agent-1"],
    ]);
  });

  it("lets the tool result's agentId win over a provisional link", () => {
    const { m } = upToAgent();
    m.linkNextSubagent("agent-guess");
    const [done] = m.push(lines[7]);
    expect(done.subagent).toMatchObject({ status: "done", threadId: "agent-abc123" });
    expect(m.subagentLinks.get("toolu_2")).toBe("agent-abc123");
  });

  it("keeps a provisional link without an agentId and never links finished calls", () => {
    const m = new ClaudeTranscriptNormalizer("main");
    m.push(assistant("x1", [agentUse("toolu_a")]));
    m.push(assistant("x2", [agentUse("toolu_b")]));
    m.linkNextSubagent("agent-1");
    const [a] = m.push(user("r1", [result("toolu_a", "done")]));
    expect(a.subagent).toMatchObject({ status: "done", threadId: "agent-1" });
    const [b] = m.push(user("r2", [result("toolu_b", "failed", { is_error: true })]));
    expect(b.subagent).toMatchObject({ status: "error", threadId: "toolu_b" });
    expect(m.linkSubagentByParent("x2", "agent-2")).toBeUndefined();
    expect(m.linkNextSubagent("agent-2")).toBeUndefined();
  });

  it("refuses to link a thread that is already linked to another Agent call", () => {
    // toolu_2 finished with agentId abc123; a later Agent call is running when the watcher
    // reports agent-abc123's file late. The FIFO fallback must not hand it to toolu_9.
    const m = new ClaudeTranscriptNormalizer("main");
    for (const l of lines.slice(0, 8)) m.push(l);
    m.push(assistant("x9", [agentUse("toolu_9")]));
    expect(m.linkSubagentByParent("a3", "agent-abc123")).toBeUndefined();
    expect(m.linkNextSubagent("agent-abc123")).toBeUndefined();
    expect(m.linkNextSubagent("agent-new")).toMatchObject({ id: "toolu_9" });
  });
});

describe("push (rulings 2 to 4)", () => {
  it("returns every event a line produces and fresh snapshots on upsert", () => {
    const m = new ClaudeTranscriptNormalizer("t");
    const started = m.push(
      assistant("x1", [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Running both." },
        toolUse("toolu_a", "Bash", { command: "npm test" }),
        toolUse("toolu_b", "Read", { file_path: "a.ts" }),
      ]),
    );
    expect(started.map((e) => [e.kind, e.id])).toEqual([
      ["assistant", "x1"],
      ["tool", "toolu_a"],
      ["tool", "toolu_b"],
    ]);
    const finished = m.push(user("r1", [result("toolu_b", "B"), result("toolu_a", "A")]));
    expect(finished.map((e) => [e.id, e.tool?.status, e.tool?.result])).toEqual([
      ["toolu_b", "ok", "B"],
      ["toolu_a", "ok", "A"],
    ]);
    expect(started[1].tool).toMatchObject({ status: "running" }); // earlier snapshot untouched
    expect(started[1].tool).not.toHaveProperty("result");
    expect(m.push(user("r2", [result("toolu_a", "again")]))).toEqual([]); // already closed
  });

  it("joins text blocks, ignores thinking, and emits nothing for a tool_use-only line", () => {
    const m = new ClaudeTranscriptNormalizer("t");
    expect(
      m.push(
        assistant("x1", [
          { type: "text", text: "One." },
          { type: "redacted_thinking", data: "..." },
          { type: "text", text: "Two." },
        ]),
      ),
    ).toEqual([{ id: "x1", threadId: "t", at: T, kind: "assistant", text: "One.\n\nTwo." }]);
    expect(m.lastAssistantText).toBe("One.\n\nTwo.");
    expect(m.push(assistant("x2", [{ type: "thinking", thinking: "only thinking" }]))).toEqual([]);
    expect(m.push(assistant("x3", [toolUse("toolu_c", "Glob", { pattern: "*.ts" })]))).toEqual([
      expect.objectContaining({ kind: "tool", id: "toolu_c" }),
    ]);
    expect(m.push(assistant("x4", [{ type: "text", text: "Later." }]))).toHaveLength(1);
    expect(m.lastAssistantText).toBe("Later.");
  });

  it("emits a user event for text-block content", () => {
    const m = new ClaudeTranscriptNormalizer("t");
    expect(
      m.push(
        user("u1", [
          { type: "text", text: "Hi" },
          { type: "text", text: "there" },
        ]),
      ),
    ).toEqual([{ id: "u1", threadId: "t", at: T, kind: "user", text: "Hi\n\nthere" }]);
  });

  it("joins array result content and truncates input and result to 4000 chars", () => {
    const m = new ClaudeTranscriptNormalizer("t");
    const long = { command: "y".repeat(5000) };
    const [run] = m.push(assistant("x1", [toolUse("toolu_a", "Bash", long)]));
    expect(run.tool!.input).toBe(JSON.stringify(long).slice(0, 4000) + "…");
    expect(run.tool!.summary).toBe("y".repeat(120) + "…"); // summaries are capped too
    m.push(assistant("x2", [toolUse("toolu_b", "Read", { file_path: "a.ts" })]));
    m.push(assistant("x3", [toolUse("toolu_c", "Read", { file_path: "b.ts" })]));
    const [a, b, c] = m.push(
      user("r1", [
        result("toolu_a", "x".repeat(5000)),
        result("toolu_b", "z".repeat(4000)),
        result("toolu_c", [
          { type: "text", text: "first" },
          { type: "image", source: {} },
          { type: "text", text: "second" },
        ]),
      ]),
    );
    expect(a.tool!.result).toBe("x".repeat(4000) + "…");
    expect(b.tool!.result).toBe("z".repeat(4000));
    expect(c.tool!.result).toBe("first\n\nsecond");
  });

  it("clears a pending question when its tool_result arrives", () => {
    const m = new ClaudeTranscriptNormalizer("t");
    const [q] = m.push(
      assistant("x1", [
        toolUse("toolu_q", "AskUserQuestion", {
          questions: [
            {
              question: "Pick some",
              multiSelect: true,
              options: [{ label: "A (recommended)" }, { label: "B" }],
            },
          ],
        }),
      ]),
    );
    expect(q).toMatchObject({ kind: "question", text: "Pick some" });
    expect(q.pending).toEqual({
      kind: "question",
      id: "toolu_q",
      text: "Pick some",
      multiSelect: true,
      allowsText: true,
      options: [{ label: "A", recommended: true }, { label: "B" }],
    });
    expect(m.pendingQuestion).toEqual(q.pending);
    const [answered] = m.push(user("r1", [result("toolu_q", "User answered A")]));
    expect(answered).toMatchObject({ id: "toolu_q", kind: "question", text: "Pick some" });
    expect(answered).not.toHaveProperty("pending");
    expect(m.pendingQuestion).toBeUndefined();
    expect(q.pending).toBeDefined(); // the earlier snapshot is untouched
  });

  it("treats an AskUserQuestion without questions as a plain tool", () => {
    const m = new ClaudeTranscriptNormalizer("t");
    expect(m.push(assistant("x1", [toolUse("toolu_q", "AskUserQuestion", {})]))).toMatchObject([
      { kind: "tool", tool: { name: "AskUserQuestion", status: "running" } },
    ]);
    expect(m.pendingQuestion).toBeUndefined();
  });

  it("uses the previous event's time, else the current time, when timestamp is missing", () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00.000Z") });
    try {
      const m = new ClaudeTranscriptNormalizer("t");
      const untimed = (line: { timestamp?: string }) => {
        delete line.timestamp;
        return line;
      };
      expect(m.push(untimed(user("u1", "first")))[0].at).toBe("2026-10-31T12:00:00.000Z");
      expect(m.push(assistant("x1", [{ type: "text", text: "timed" }]))[0].at).toBe(T);
      expect(m.push(untimed(assistant("x2", [{ type: "text", text: "untimed" }])))[0].at).toBe(T);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws on garbage and ignores lines it does not understand", () => {
    const m = new ClaudeTranscriptNormalizer("t");
    const garbage: unknown[] = [
      null,
      42,
      "text",
      [],
      { type: "assistant" },
      { type: "assistant", message: { content: 5 } },
      { type: "assistant", uuid: "x", message: { content: [null, 3, { type: "tool_use" }] } },
      {
        type: "user",
        uuid: "y",
        message: { content: [{ type: "tool_result", tool_use_id: "no" }] },
      },
      { type: "summary", summary: "s", leafUuid: "u1" },
      { type: "future-line-type", message: { role: "user", content: "not for the chat" } },
    ];
    const out: ChatEvent[] = [];
    for (const line of garbage) out.push(...m.push(line));
    expect(out).toEqual([]);
  });
});

describe("what counts as the user's own message", () => {
  const texts = (lines: unknown[]): (string | undefined)[] => {
    const n = new ClaudeTranscriptNormalizer("main");
    return lines.flatMap((l) => n.push(l)).map((e) => e.text);
  };

  it("drops machine-made lines: meta lines, hand-backs, notifications, command output", () => {
    expect(
      texts([
        user(
          "u1",
          "<task-notification><task-id>t1</task-id><status>completed</status></task-notification>",
        ),
        user("u2", "<agent-message>done, see D:\\p\\out.md</agent-message>"),
        user("u3", "<local-command-stdout>Set model to Fable</local-command-stdout>"),
        user("u4", "<system-reminder>Remember the todo list.</system-reminder>"),
        user("u5", "Caveat: the messages below were generated by the user", { isMeta: true }),
      ]),
    ).toEqual([]);
  });

  it("keeps what the user typed, without the reminder Claude Code adds to it", () => {
    expect(
      texts([user("u1", "fix the build\n<system-reminder>Todo list is empty.</system-reminder>")]),
    ).toEqual(["fix the build"]);
    expect(typedByUser("a <b>bold</b> idea")).toBe("a <b>bold</b> idea");
    expect(typedByUser("<div>one tag, no hyphen</div>")).toBe("<div>one tag, no hyphen</div>");
  });

  it("shows a slash command as it was typed", () => {
    const line =
      "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>";
    expect(texts([user("u1", line)])).toEqual(["/model opus"]);
    expect(
      texts([user("u2", "<command-name>/clear</command-name><command-args></command-args>")]),
    ).toEqual(["/clear"]);
  });
});

describe("an answered question", () => {
  const ask = toolUse("q1", "AskUserQuestion", {
    questions: [{ question: "Which color?", multiSelect: false, options: [{ label: "Blue" }] }],
  });
  const result = [{ type: "tool_result", tool_use_id: "q1", content: "answered" }];

  it("shows the answer under the question once its result arrives", () => {
    const n = new ClaudeTranscriptNormalizer("main");
    n.push(assistant("a1", [ask]));
    const [done] = n.push(
      user("u1", result, { toolUseResult: { answers: { "Which color?": "Blue" } } }),
    );
    expect(done).toMatchObject({ id: "q1", kind: "question" });
    expect(done?.text).toBe("Which color?\n\n**Answer:** Blue");
    expect(done?.pending).toBeUndefined();
  });

  it("keeps the question alone when the result names no answer", () => {
    const n = new ClaudeTranscriptNormalizer("main");
    n.push(assistant("a1", [ask]));
    const [done] = n.push(user("u1", result));
    expect(done?.text).toBe("Which color?");
  });
});
