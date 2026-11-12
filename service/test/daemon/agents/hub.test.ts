import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatHub } from "../../../src/daemon/agents/hub.js";
import { SessionRegistry } from "../../../src/daemon/sessions/registry.js";
import type { NotifyKind } from "../../../src/daemon/sessions/state.js";
import type { ChatEvent, Pending, Session, Strip } from "../../../src/protocol/index.js";
import { createFakePty } from "../../helpers/fake-pty.js";
import { readFixtureLines } from "../../helpers/fixtures.js";

const POLL_MS = 20;
/** How long the hub keeps reading after a session's process exits (5 s in the daemon). */
const EXIT_GRACE_MS = 150;
const NOW = "2026-10-31T10:00:00.000Z";
const LINE_AT = "2026-10-30T13:40:00.000Z";
const HOUR = 3_600_000;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Claude's sub-agent folder is derived with Windows path rules (`subagentDirFor`). */
const onWindows = it.skipIf(process.platform !== "win32");

const MAIN = readFixtureLines("claude/main.jsonl");
const AGENT = readFixtureLines("claude/agent-abc123.jsonl");
const ROLLOUT = readFixtureLines("codex/rollout.jsonl");
/** The main fixture's 9 events upsert into these 6 ids. */
const MAIN_IDS = ["u1", "a1", "toolu_1", "toolu_2", "toolu_3", "toolu_4"];
/** Lines 1–7 of the main fixture end on the Agent call toolu_2 (line a3), still running. */
const MAIN_UNTIL_AGENT = MAIN.slice(0, 7);
/** The main fixture's AskUserQuestion line (toolu_3), which the fixture never answers. */
const QUESTION_LINE = MAIN[8];
const ANSWER_LINE = userToolResult("u5", "toolu_3", "Session cookies");
const ROLLOUT_IDS = ["ord-2", "c1", "ord-7"];
/** The only assistant text in the main fixture (line a1). */
const A1_TEXT = "I'll check how sessions are handled today.";

let dir: string;
let clock: Date;
let fakes: ReturnType<typeof createFakePty>;
let registry: SessionRegistry;
let hub: ChatHub;
let sid: string;
let chats: { sessionId: string; threadId: string; event: ChatEvent }[];
let strips: { sessionId: string; strip: Strip }[];
let resets: { sessionId: string; threadId: string }[];
let errors: [string, Error][];
let transcript: string;
let subagentDir: string;
let rollout: string;

const jsonl = (lines: unknown[]) => lines.map((line) => `${JSON.stringify(line)}\n`).join("");
const write = (file: string, lines: unknown[]) => writeFileSync(file, jsonl(lines));
const append = (file: string, ...lines: unknown[]) => appendFileSync(file, jsonl(lines));
const session = (id = sid): Session => registry.get(id)!.session;
const ids = (events: ChatEvent[]) => events.map((e) => e.id);
const chatsFor = (eventId: string) => chats.filter((c) => c.event.id === eventId);
const mainEvent = (eventId: string, id = sid) =>
  hub.history(id, "main").find((e) => e.id === eventId);

function assistantText(uuid: string, text: string) {
  return {
    type: "assistant",
    uuid,
    timestamp: LINE_AT,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function askUserQuestion(uuid: string, toolUseId: string) {
  const question = { question: "Which one?", header: "Pick", multiSelect: false, options: [] };
  return {
    type: "assistant",
    uuid,
    timestamp: LINE_AT,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "AskUserQuestion",
          input: { questions: [question] },
        },
      ],
    },
  };
}

function agentCall(uuid: string, toolUseId: string) {
  const input = { subagent_type: "Plan", description: "plan the change", prompt: "Plan it" };
  return {
    type: "assistant",
    uuid,
    timestamp: LINE_AT,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: toolUseId, name: "Agent", input }],
    },
  };
}

function userToolResult(uuid: string, toolUseId: string, content: string) {
  return {
    type: "user",
    uuid,
    timestamp: LINE_AT,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  };
}

function codexEvent(payload: Record<string, unknown>) {
  return { timestamp: LINE_AT, type: "event_msg", payload };
}

async function newSession(kind: "claude" | "codex" = "claude"): Promise<string> {
  return (await registry.create({ cwd: dir, kind, args: [] })).id;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-hub-"));
  transcript = join(dir, "sess-1.jsonl");
  subagentDir = join(dir, "sess-1", "subagents");
  rollout = join(dir, "rollout.jsonl");
  clock = new Date(NOW);
  fakes = createFakePty();
  registry = new SessionRegistry({
    ptyFactory: fakes.factory,
    shell: { exe: "powershell.exe", kind: "powershell" },
    sessionsDir: join(dir, "afk-sessions"),
    port: 2350,
    nodeExe: "node.exe",
    cliEntry: "cli.js",
    ringBufferBytes: 4096,
    snapshotScrollback: 100,
    retentionHours: 24,
    now: () => clock,
    baseEnv: {},
  });
  sid = await newSession();
  chats = [];
  strips = [];
  resets = [];
  errors = [];
  hub = new ChatHub(registry, {
    pollMs: POLL_MS,
    exitGraceMs: EXIT_GRACE_MS,
    now: () => new Date(NOW),
    onError: (id, err) => errors.push([id, err]),
  });
  hub.on("chat", (c) => chats.push(c));
  hub.on("strip", (s) => strips.push(s));
  hub.on("reset", (r) => resets.push(r));
});

afterEach(async () => {
  for (const s of registry.list()) hub.detach(s.id);
  registry.stopAll();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("ChatHub with a Claude transcript", () => {
  it("attachClaude replays the main fixture into history and emits chat events as lines are appended", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS));
    // One "chat" per event the normaliser produced: the 9 events behind the 6 ids.
    expect(chats).toHaveLength(9);
    expect(chats.every((c) => c.sessionId === sid && c.threadId === "main")).toBe(true);
    // toolu_1's result replaced its call in place.
    expect(hub.history(sid, "main")[2]).toMatchObject({ id: "toolu_1", tool: { status: "ok" } });
    expect(hub.threads(sid)).toEqual(["main"]);

    append(transcript, assistantText("a6", "Tests fixed."));
    await vi.waitFor(() => expect(chats).toHaveLength(10));
    expect(chats[9]).toEqual({
      sessionId: sid,
      threadId: "main",
      event: { id: "a6", threadId: "main", at: LINE_AT, kind: "assistant", text: "Tests fixed." },
    });

    // Answering the replayed question updates toolu_3 where it stands, ahead of later events.
    append(transcript, ANSWER_LINE);
    await vi.waitFor(() => expect(chats).toHaveLength(11));
    expect(chats[10].event).toMatchObject({ id: "toolu_3", kind: "question" });
    expect(ids(hub.history(sid, "main"))).toEqual([...MAIN_IDS, "a6"]);
    expect(mainEvent("toolu_3")?.pending).toBeUndefined();
  });

  it("forwards no signals from replayed lines: the fixture's open question stays off the session", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS));
    expect(session().pending).toBeUndefined();
    // A live line after the replay does not deliver the replayed question late either.
    append(transcript, assistantText("a6", "Still here."));
    await vi.waitFor(() => expect(chatsFor("a6")).toHaveLength(1));
    expect(session().pending).toBeUndefined();
    expect(session().state).toBe("idle");
  });

  it("forwards signals: AskUserQuestion in the transcript sets pending on the session even without a hook", async () => {
    write(
      transcript,
      MAIN.filter((line) => line !== QUESTION_LINE),
    );
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() =>
      expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS.filter((id) => id !== "toolu_3")),
    );

    append(transcript, QUESTION_LINE);
    await vi.waitFor(() => expect(session().pending?.id).toBe("toolu_3"));
    expect(session().state).toBe("needs_input");
    // The transcript's question event stands: the pending coming back from the registry neither
    // replaces it with a bare one nor emits it a second time.
    expect(chatsFor("toolu_3")).toHaveLength(1);
    expect(mainEvent("toolu_3")).toMatchObject({
      kind: "question",
      text: "Which auth approach should I use?",
      pending: { kind: "question", id: "toolu_3" },
    });

    append(transcript, ANSWER_LINE);
    await vi.waitFor(() => expect(session().pending).toBeUndefined());
    expect(session().state).toBe("working");
    expect(mainEvent("toolu_3")?.pending).toBeUndefined();
    expect(chatsFor("toolu_3")).toHaveLength(2);
  });

  it("attachClaude waits for a transcript that does not exist yet and treats its lines as new", async () => {
    hub.attachClaude(sid, transcript);
    await pause(POLL_MS * 3); // the first polls find no file: there is nothing to replay
    write(transcript, MAIN.slice(0, 9)); // ends on the unanswered AskUserQuestion
    await vi.waitFor(() => expect(session().pending?.id).toBe("toolu_3"));
    expect(ids(hub.history(sid, "main"))).toEqual(["u1", "a1", "toolu_1", "toolu_2", "toolu_3"]);
  });

  onWindows(
    "discovers a sub-agent file, exposes its thread and links the running Agent call",
    async () => {
      // An older Agent call (toolu_0) also runs, so only the parent link picks toolu_2.
      write(transcript, [...MAIN.slice(0, 6), agentCall("a2b", "toolu_0"), MAIN[6]]);
      hub.attachClaude(sid, transcript);
      await vi.waitFor(() =>
        expect(mainEvent("toolu_2")?.subagent).toMatchObject({ threadId: "toolu_2" }),
      );
      // The sub-agent folder did not exist when the session was attached.
      mkdirSync(subagentDir, { recursive: true });
      const agentFile = join(subagentDir, "agent-abc123.jsonl");
      write(agentFile, AGENT);
      await vi.waitFor(() =>
        expect(ids(hub.history(sid, "agent-abc123"))).toEqual(["s1", "toolu_s1", "s4"]),
      );
      expect(hub.threads(sid)).toEqual(["main", "agent-abc123"]);
      expect(chats.filter((c) => c.threadId === "agent-abc123")).toHaveLength(4);
      // fork-context-ref names a3, the line holding toolu_2: the running card now opens the thread.
      expect(chatsFor("toolu_2").at(-1)).toMatchObject({
        threadId: "main",
        event: { subagent: { threadId: "agent-abc123", status: "running" } },
      });
      expect(mainEvent("toolu_2")?.subagent?.threadId).toBe("agent-abc123");
      expect(mainEvent("toolu_0")?.subagent?.threadId).toBe("toolu_0");

      // A question asked inside a sub-agent is shown in its thread but is not a session signal.
      // flush reads the sub-agent's file too, at once.
      append(agentFile, askUserQuestion("s5", "toolu_s2"));
      hub.flush(sid);
      expect(chatsFor("toolu_s2")).toHaveLength(1);
      expect(session().pending).toBeUndefined();
    },
  );

  onWindows(
    "reads the main transcript before linking a sub-agent file that appeared with its Agent call",
    async () => {
      write(transcript, MAIN.slice(0, 6));
      // While the main tailer is reading, the Agent call is appended and its sub-agent's file
      // created: the watcher finds the file before the main tailer's next poll.
      hub.once("chat", () => {
        append(transcript, MAIN[6]);
        mkdirSync(subagentDir, { recursive: true });
        write(join(subagentDir, "agent-abc123.jsonl"), AGENT);
      });
      hub.attachClaude(sid, transcript);
      await vi.waitFor(() => expect(hub.threads(sid)).toEqual(["main", "agent-abc123"]));
      await vi.waitFor(() => expect(mainEvent("toolu_2")?.subagent?.threadId).toBe("agent-abc123"));
    },
  );

  onWindows(
    "links a sub-agent whose first line names no known parent to the oldest running Agent call",
    async () => {
      write(transcript, MAIN_UNTIL_AGENT);
      hub.attachClaude(sid, transcript);
      await vi.waitFor(() => expect(mainEvent("toolu_2")).toBeDefined());
      mkdirSync(subagentDir, { recursive: true });
      const forkRef = { type: "fork-context-ref", agentId: "zzz", parentLastUuid: "not-a-line" };
      write(join(subagentDir, "agent-zzz.jsonl"), [forkRef, ...AGENT.slice(1)]);
      await vi.waitFor(() => expect(mainEvent("toolu_2")?.subagent?.threadId).toBe("agent-zzz"));
      expect(hub.threads(sid)).toEqual(["main", "agent-zzz"]);
    },
  );

  onWindows(
    "re-attaching to a different transcript resets every thread, sub-agent threads included",
    async () => {
      write(transcript, MAIN_UNTIL_AGENT);
      mkdirSync(subagentDir, { recursive: true });
      write(join(subagentDir, "agent-abc123.jsonl"), AGENT);
      hub.attachClaude(sid, transcript);
      await vi.waitFor(() => expect(hub.threads(sid)).toEqual(["main", "agent-abc123"]));
      expect(resets).toEqual([]);

      hub.attachClaude(sid, join(dir, "sess-2.jsonl"));
      expect(resets).toEqual([
        { sessionId: sid, threadId: "main" },
        { sessionId: sid, threadId: "agent-abc123" },
      ]);
      expect(hub.threads(sid)).toEqual(["main"]);
    },
  );

  it("a truncated transcript resets the main thread before it is replayed", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS));
    write(transcript, MAIN.slice(0, 4)); // shorter than what was read: metadata, u1, a1
    await vi.waitFor(() => expect(resets).toEqual([{ sessionId: sid, threadId: "main" }]));
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(["u1", "a1"]));
  });

  it("turn_end without a lastMessage takes the transcript's last assistant text, cut to 200 characters", async () => {
    const notes: { kind: NotifyKind; session: Session }[] = [];
    registry.on("notify", (n) => notes.push(n));
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS));

    registry.signal(sid, { kind: "turn_start" });
    registry.signal(sid, { kind: "turn_end" });
    expect(session()).toMatchObject({ state: "finished", lastMessage: A1_TEXT });
    // Set while the signal is applied, so the "finished" notification already carries it.
    expect(notes.at(-1)).toMatchObject({ kind: "finished", session: { lastMessage: A1_TEXT } });

    registry.signal(sid, { kind: "turn_start" });
    append(transcript, assistantText("a6", "x".repeat(300)));
    await vi.waitFor(() => expect(chatsFor("a6")).toHaveLength(1));
    registry.signal(sid, { kind: "turn_end" });
    expect(session().lastMessage).toBe(`${"x".repeat(199)}…`);
    expect(session().lastMessage).toHaveLength(200); // the ellipsis included

    registry.signal(sid, { kind: "turn_start" });
    registry.signal(sid, { kind: "turn_end", lastMessage: "From the hook." });
    expect(session().lastMessage).toBe("From the hook.");
  });

  it("flush reads the transcript now, so a Stop hook that beats the next poll gets the final reply", async () => {
    const notes: { kind: NotifyKind; session: Session }[] = [];
    registry.on("notify", (n) => notes.push(n));
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS));
    registry.signal(sid, { kind: "turn_start" });

    // The final reply is written and the Stop hook arrives before the tailer polls again.
    append(transcript, assistantText("a6", "All tests pass."));
    hub.flush(sid);
    registry.signal(sid, { kind: "turn_end" });
    expect(session().lastMessage).toBe("All tests pass.");
    expect(notes.at(-1)).toMatchObject({
      kind: "finished",
      session: { lastMessage: "All tests pass." },
    });
    expect(ids(hub.history(sid, "main")).slice(-3)).toEqual(["turn-1", "a6", "turn-2"]);

    hub.flush("no-such-session"); // unknown: nothing to read
    hub.detach(sid);
    hub.flush(sid); // detached: nothing to read
  });

  it("with no phone connected the transcript is read less often, and at once when one connects", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS));

    hub.setWatched(false);
    await pause(POLL_MS * 2); // the wait under way was a short one; the next is 8 times longer
    append(transcript, assistantText("a6", "Still here."));
    await pause(POLL_MS * 3);
    expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS);

    hub.setWatched(true);
    expect(ids(hub.history(sid, "main")).at(-1)).toBe("a6");
  });

  it("a reply read after the turn ended still becomes the session's lastMessage", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS));

    registry.signal(sid, { kind: "turn_start" });
    append(transcript, assistantText("a6", "Working on it."));
    await vi.waitFor(() => expect(chatsFor("a6")).toHaveLength(1));
    expect(session().lastMessage).toBeUndefined(); // mid-turn replies leave it alone

    registry.signal(sid, { kind: "turn_end" });
    expect(session().lastMessage).toBe("Working on it.");
    append(transcript, assistantText("a7", "y".repeat(250))); // written after the Stop hook
    await vi.waitFor(() => expect(session().lastMessage).toBe(`${"y".repeat(199)}…`));
  });
});

describe("ChatHub with a Codex rollout", () => {
  it("attachCodex replays the rollout without forwarding its signals, then forwards live turns", async () => {
    write(rollout, ROLLOUT);
    hub.attachCodex(sid, rollout);
    await vi.waitFor(() => expect(hub.latestStrip(sid)?.contextSize).toBe(258400));
    expect(ids(hub.history(sid, "main"))).toEqual(ROLLOUT_IDS);
    expect(strips).toEqual([{ sessionId: sid, strip: hub.latestStrip(sid) }]);
    // The replayed task_started / task_complete were history, not news.
    expect(session().state).toBe("idle");
    expect(chats.some((c) => c.event.kind === "turn")).toBe(false);

    append(rollout, codexEvent({ type: "task_started", turn_id: "t2" }));
    await vi.waitFor(() => expect(session().state).toBe("working"));
    append(
      rollout,
      codexEvent({ type: "task_complete", turn_id: "t2", last_agent_message: "Committed." }),
    );
    await vi.waitFor(() => expect(session().state).toBe("finished"));
    expect(session().lastMessage).toBe("Committed.");
    expect(hub.history(sid, "main").slice(-2)).toMatchObject([
      { id: "turn-1", kind: "turn", turn: { phase: "start" } },
      { id: "turn-2", kind: "turn", turn: { phase: "end" } },
    ]);
  });

  it("sets agentSessionId from the rollout only when the session has none", async () => {
    write(rollout, ROLLOUT);
    hub.attachCodex(sid, rollout);
    await vi.waitFor(() => expect(session().agentSessionId).toBe("thread-1"));

    const other = await newSession("codex");
    registry.setMeta(other, { agentSessionId: "from-notify" });
    hub.attachCodex(other, rollout);
    await vi.waitFor(() => expect(ids(hub.history(other, "main"))).toEqual(ROLLOUT_IDS));
    expect(session(other).agentSessionId).toBe("from-notify");
  });

  it("re-replays a truncated rollout: history is rebuilt and the rewritten lines forward nothing", async () => {
    write(rollout, ROLLOUT);
    hub.attachCodex(sid, rollout);
    await vi.waitFor(() => expect(ids(hub.history(sid, "main"))).toEqual(ROLLOUT_IDS));

    const restart = {
      timestamp: LINE_AT,
      ordinal: 2,
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Again" }] },
    };
    expect(resets).toEqual([]);
    write(rollout, [ROLLOUT[0], ROLLOUT[1], restart]); // shorter than what was read: a reset
    await vi.waitFor(() =>
      expect(hub.history(sid, "main")).toMatchObject([{ id: "ord-2", text: "Again" }]),
    );
    // Subscribers are told the thread was cleared, so they can take a fresh snapshot.
    expect(resets).toEqual([{ sessionId: sid, threadId: "main" }]);
    expect(session().state).toBe("idle"); // the rewritten task_started was replayed

    append(rollout, codexEvent({ type: "task_started", turn_id: "t2" }));
    await vi.waitFor(() => expect(session().state).toBe("working"));
  });

  it("re-attaching to a different rollout clears the session's history and strip", async () => {
    write(rollout, ROLLOUT);
    hub.attachCodex(sid, rollout);
    await vi.waitFor(() => expect(hub.latestStrip(sid)).toBeDefined());

    // Its ord-N ids collide with the first file's: kept history would mix the two.
    const second = join(dir, "rollout-2.jsonl");
    const message = {
      timestamp: LINE_AT,
      ordinal: 2,
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Other" }] },
    };
    write(second, [ROLLOUT[0], message]);
    expect(resets).toEqual([]);
    hub.attachCodex(sid, second);
    expect(resets).toEqual([{ sessionId: sid, threadId: "main" }]);
    expect(hub.history(sid, "main")).toEqual([]);
    expect(hub.latestStrip(sid)).toBeUndefined();
    await vi.waitFor(() =>
      expect(hub.history(sid, "main")).toMatchObject([{ id: "ord-2", text: "Other" }]),
    );
  });
});

describe("ChatHub session signals", () => {
  it("does not repeat a turn marker of the same phase", async () => {
    const markers = (id: string) =>
      chats.filter((c) => c.sessionId === id && c.event.kind === "turn").map((c) => c.event.turn);
    // Codex reports a turn's end twice: from the rollout and from its notify hook.
    registry.signal(sid, { kind: "turn_end" });
    registry.signal(sid, { kind: "turn_end" });
    expect(markers(sid)).toEqual([{ phase: "end" }]);

    const other = await newSession();
    for (const kind of ["turn_start", "turn_end", "turn_end", "turn_start"] as const) {
      registry.signal(other, { kind });
    }
    expect(markers(other)).toEqual([{ phase: "start" }, { phase: "end" }, { phase: "start" }]);
    expect(ids(hub.history(other, "main"))).toEqual(["turn-1", "turn-2", "turn-3"]);
  });

  it("emits turn events on turn_start and turn_end signals", async () => {
    registry.signal(sid, { kind: "turn_start" });
    registry.signal(sid, { kind: "turn_end" });
    const turn = (id: string, phase: "start" | "end") => ({
      sessionId: sid,
      threadId: "main",
      event: { id, threadId: "main", at: NOW, kind: "turn", turn: { phase } },
    });
    expect(chats).toEqual([turn("turn-1", "start"), turn("turn-2", "end")]);
    expect(ids(hub.history(sid, "main"))).toEqual(["turn-1", "turn-2"]);

    // Numbering is per session.
    const other = await newSession();
    registry.signal(other, { kind: "turn_start" });
    expect(chats.at(-1)).toMatchObject({ sessionId: other, event: { id: "turn-1" } });
  });

  it("emits a permission chat event when a permission pending arrives and re-emits it resolved when cleared", () => {
    const pending: Pending = {
      kind: "permission",
      id: "perm-1",
      tool: "Bash",
      summary: "npm test",
    };
    registry.signal(sid, { kind: "pending", pending });
    const shown = { id: "perm-1", threadId: "main", at: NOW, kind: "permission" } as const;
    expect(chats).toEqual([{ sessionId: sid, threadId: "main", event: { ...shown, pending } }]);

    registry.signal(sid, { kind: "pending_cleared", pendingId: "perm-1" });
    expect(chats[1]).toEqual({ sessionId: sid, threadId: "main", event: shown });
    expect(hub.history(sid, "main")).toEqual([shown]);
  });

  it("a pending replaced by another, or cleared without an id, is shown resolved", () => {
    registry.signal(sid, { kind: "pending", pending: perm("perm-1") });
    registry.signal(sid, { kind: "pending", pending: perm("perm-2") });
    expect(hub.history(sid, "main")).toEqual([
      permEvent("perm-1"),
      { ...permEvent("perm-2"), pending: perm("perm-2") },
    ]);
    registry.signal(sid, { kind: "pending_cleared" });
    expect(hub.history(sid, "main")).toEqual([permEvent("perm-1"), permEvent("perm-2")]);
  });

  it("a permission card is resolved when a turn starts or the process exits", () => {
    registry.signal(sid, { kind: "pending", pending: perm("perm-1") });
    registry.signal(sid, { kind: "turn_start" });
    expect(hub.history(sid, "main")).toMatchObject([permEvent("perm-1"), { id: "turn-1" }]);
    expect(mainEvent("perm-1")?.pending).toBeUndefined();

    registry.signal(sid, { kind: "pending", pending: perm("perm-2") });
    fakes.last.emitExit(1);
    expect(session().state).toBe("ended");
    expect(mainEvent("perm-2")).toEqual(permEvent("perm-2"));
  });
});

function perm(id: string): Pending {
  return { kind: "permission", id, tool: "Bash", summary: `run ${id}` };
}

/** A permission card as the hub shows it once resolved (no `pending`). */
function permEvent(id: string): ChatEvent {
  return { id, threadId: "main", at: NOW, kind: "permission" };
}

describe("ChatHub attachments", () => {
  it("detach stops tailers (no events after append) and is idempotent", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(chats).toHaveLength(9));
    hub.detach(sid);
    hub.detach(sid);
    hub.detach("no-such-session");

    append(transcript, assistantText("a6", "Too late."));
    mkdirSync(subagentDir, { recursive: true });
    write(join(subagentDir, "agent-abc123.jsonl"), AGENT);
    await pause(POLL_MS * 5);
    expect(chats).toHaveLength(9);
    expect(hub.threads(sid)).toEqual(["main"]);
    expect(ids(hub.history(sid, "main"))).toEqual(MAIN_IDS); // detaching keeps the history
  });

  it("attaching an attached session to the same file again replaces the attachment, keeping history and strip", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(chats).toHaveLength(9));
    const strip: Strip = { at: NOW, contextUsedPct: 5 };
    hub.updateStrip(sid, strip);
    registry.signal(sid, { kind: "turn_start" });

    hub.attachClaude(sid, transcript);
    expect(ids(hub.history(sid, "main"))).toEqual([...MAIN_IDS, "turn-1"]);
    expect(hub.latestStrip(sid)).toEqual(strip);
    expect(resets).toEqual([]); // nothing was cleared
    await vi.waitFor(() => expect(chats).toHaveLength(19)); // the new attachment replays

    append(transcript, assistantText("a6", "Once."));
    await vi.waitFor(() => expect(chatsFor("a6")).toHaveLength(1));
    await pause(POLL_MS * 3);
    expect(chatsFor("a6")).toHaveLength(1);
    expect(ids(hub.history(sid, "main"))).toEqual([...MAIN_IDS, "turn-1", "a6"]);
  });

  it("stops reading a session's files a grace period after its process exits, keeping history", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(chats).toHaveLength(9));
    const strip: Strip = { at: NOW, contextUsedPct: 7 };
    hub.updateStrip(sid, strip);

    fakes.last.emitExit(0);
    append(transcript, assistantText("a6", "Written as it exits."));
    await vi.waitFor(() => expect(chatsFor("a6")).toHaveLength(1)); // still read in the grace
    await pause(EXIT_GRACE_MS + POLL_MS * 2);
    append(transcript, assistantText("a7", "Too late."));
    await pause(POLL_MS * 5);
    expect(chatsFor("a7")).toEqual([]);
    expect(ids(hub.history(sid, "main"))).toEqual([...MAIN_IDS, "a6"]);
    expect(hub.latestStrip(sid)).toEqual(strip);
  });

  it("attaching again after the exit cancels the pending stop", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(chats).toHaveLength(9));
    fakes.last.emitExit(0);
    hub.attachClaude(sid, transcript);
    await pause(EXIT_GRACE_MS + POLL_MS * 2);
    append(transcript, assistantText("a6", "Still read."));
    await vi.waitFor(() => expect(chatsFor("a6")).toHaveLength(1));
  });

  it("routes tailer errors to onError", async () => {
    hub.attachClaude(sid, join(dir, "bad\0name.jsonl")); // Node refuses a path with a NUL byte
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(errors[0][0]).toBe(sid);
    expect(errors[0][1]).toBeInstanceOf(Error);
  });

  it("updateStrip stores and emits the strip; a removed session's history and strip are dropped", async () => {
    write(transcript, MAIN);
    hub.attachClaude(sid, transcript);
    await vi.waitFor(() => expect(chats).toHaveLength(9));
    const strip: Strip = { at: NOW, contextUsedPct: 12 };
    hub.updateStrip(sid, strip);
    expect(hub.latestStrip(sid)).toEqual(strip);
    expect(strips).toEqual([{ sessionId: sid, strip }]);

    fakes.last.emitExit(0);
    clock = new Date(clock.getTime() + 25 * HOUR);
    registry.pruneEnded();
    expect(registry.get(sid)).toBeUndefined();
    expect(hub.history(sid, "main")).toEqual([]);
    expect(hub.threads(sid)).toEqual([]);
    expect(hub.latestStrip(sid)).toBeUndefined();

    append(transcript, assistantText("a6", "Gone."));
    await pause(POLL_MS * 5);
    expect(chats).toHaveLength(9);
  });

  it("knows nothing about sessions the registry does not have", async () => {
    expect(hub.history("no-such-session", "main")).toEqual([]);
    expect(hub.threads("no-such-session")).toEqual([]);
    expect(hub.latestStrip("no-such-session")).toBeUndefined();

    write(transcript, MAIN);
    hub.attachClaude("no-such-session", transcript);
    hub.updateStrip("no-such-session", { at: NOW });
    await pause(POLL_MS * 3);
    expect(chats).toEqual([]);
    expect(strips).toEqual([]);
    expect(hub.threads("no-such-session")).toEqual([]);
    expect(hub.history(sid, "no-such-thread")).toEqual([]);
  });
});
