import type { Pending } from "../../../src/protocol/index.js";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const text = (data: string) => Buffer.from(data, "base64").toString("utf8");

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.stop();
});

describe("pty", () => {
  it("pty.subscribe → ack then pty.snapshot with cols/rows, then pty.data for new output (base64)", async () => {
    const { session, pty } = await h.session();
    const c = await h.client();
    const reply = await c.request({
      type: "pty.subscribe",
      sessionId: session.id,
      cols: 100,
      rows: 40,
    });
    expect(reply).toEqual({ type: "ack", id: reply.id });
    const snapshot = await c.next("pty.snapshot");
    expect(snapshot).toMatchObject({ sessionId: session.id, cols: 100, rows: 40 });
    expect(text(snapshot.data)).toContain("PS> ");
    expect(pty.size).toEqual({ cols: 100, rows: 40 });

    pty.emitData("hi");
    const data = await c.next("pty.data");
    expect(data.sessionId).toBe(session.id);
    expect(Buffer.from(data.data, "base64").toString()).toBe("hi");
    expect(c.types().slice(-3)).toEqual(["ack", "pty.snapshot", "pty.data"]);

    // Unsubscribed, the client gets no more output.
    c.send({ type: "pty.unsubscribe", sessionId: session.id });
    await c.sync(); // frames are handled in order
    pty.emitData("more");
    const other = await h.client();
    await other.request({ type: "pty.subscribe", sessionId: session.id, cols: 100, rows: 40 });
    pty.emitData("for other");
    await other.next("pty.data");
    expect(c.of("pty.data")).toHaveLength(1);
  });

  it("output written in the same tick as the snapshot is streamed, not lost", async () => {
    const { session, pty } = await h.session();
    const proc = h.registry.get(session.id)?.process;
    if (proc === undefined) throw new Error("no process");
    const snapshot = proc.snapshot.bind(proc);
    vi.spyOn(proc, "snapshot").mockImplementation(() => {
      const snap = snapshot();
      // Runs before anything the handler awaits: a gap before subscribing would drop it.
      queueMicrotask(() => pty.emitData("racing"));
      return snap;
    });
    const c = await h.client();
    await c.request({ type: "pty.subscribe", sessionId: session.id, cols: 120, rows: 30 });
    const data = await c.next("pty.data");
    expect(text(data.data)).toBe("racing");
    expect(text((await c.next("pty.snapshot")).data)).not.toContain("racing");
    expect(c.types().slice(-3)).toEqual(["ack", "pty.snapshot", "pty.data"]);
  });

  it("pty.input writes bytes; pty.resize from client B wins and client A receives pty.resized (no echo back to B)", async () => {
    const { session, pty } = await h.session();
    const a = await h.client();
    const b = await h.client();
    await a.request({ type: "pty.subscribe", sessionId: session.id, cols: 100, rows: 30 });

    // B joining at another size resizes the pty; A is told, B is not.
    await b.request({ type: "pty.subscribe", sessionId: session.id, cols: 80, rows: 24 });
    expect(await b.next("pty.snapshot")).toMatchObject({ cols: 80, rows: 24 });
    expect(await a.next("pty.resized")).toEqual({
      type: "pty.resized",
      sessionId: session.id,
      cols: 80,
      rows: 24,
    });

    b.send({ type: "pty.resize", sessionId: session.id, cols: 90, rows: 25 });
    await a.next("pty.resized", (r) => r.cols === 90);
    expect(pty.size).toEqual({ cols: 90, rows: 25 });
    expect(b.of("pty.resized")).toEqual([]);

    b.send({ type: "pty.input", sessionId: session.id, data: b64("ls\r") });
    await vi.waitFor(() => expect(pty.written.at(-1)?.toString()).toBe("ls\r"));

    // A resize to the size the pty already has tells nobody.
    a.send({ type: "pty.resize", sessionId: session.id, cols: 90, rows: 25 });
    b.send({ type: "pty.resize", sessionId: session.id, cols: 91, rows: 25 });
    await a.next("pty.resized", (r) => r.cols === 91);
    expect(a.of("pty.resized").map((r) => r.cols)).toEqual([80, 90, 91]);
    expect(b.of("pty.resized")).toEqual([]);
  });

  it("rejects a terminal size outside 1..1000 and an unknown session", async () => {
    const { session } = await h.session();
    const c = await h.client();
    const zero = await c.request({
      type: "pty.subscribe",
      sessionId: session.id,
      cols: 0,
      rows: 30,
    });
    expect(zero).toMatchObject({ type: "error", code: "bad_request" });
    const unknown = await c.request({
      type: "pty.subscribe",
      sessionId: "s_none",
      cols: 80,
      rows: 24,
    });
    expect(unknown).toMatchObject({ type: "error", code: "not_found" });
    expect(c.of("pty.snapshot")).toEqual([]);
  });

  it("a session's exit ends its pty subscriptions; input and resize then get session_ended", async () => {
    const { session, pty } = await h.session();
    const c = await h.client();
    const watcher = await h.client();
    await c.request({ type: "pty.subscribe", sessionId: session.id, cols: 120, rows: 30 });
    await watcher.request({ type: "chat.subscribe", sessionId: session.id });
    pty.emitExit(0);
    await c.next("session.updated", (u) => u.session.state === "ended");
    // The pty subscriber no longer watches the session: a strip reaches only the chat subscriber.
    h.hub.updateStrip(session.id, { at: "2026-10-31T10:00:00.000Z", costUsd: 1 });
    await watcher.next("strip.update");
    expect(c.of("strip.update")).toEqual([]);

    c.send({ type: "pty.input", sessionId: session.id, data: b64("x") });
    c.send({ type: "pty.resize", sessionId: session.id, cols: 10, rows: 10 });
    await vi.waitFor(() => expect(c.of("error")).toHaveLength(2));
    expect(c.of("error")).toEqual([
      { type: "error", code: "session_ended", message: expect.any(String) },
      { type: "error", code: "session_ended", message: expect.any(String) },
    ]);

    // An ended session's last screen can still be fetched, without a subscription.
    const again = await c.request({
      type: "pty.subscribe",
      sessionId: session.id,
      cols: 50,
      rows: 10,
    });
    expect(again.type).toBe("ack");
    await vi.waitFor(() => expect(c.of("pty.snapshot")).toHaveLength(2));
    // Not resized: the pty is gone, the final screen keeps its size.
    expect(c.of("pty.snapshot")[1]).toMatchObject({ cols: 120, rows: 30 });
    expect(pty.size).toEqual({ cols: 120, rows: 30 });
  });
});

describe("pending.answer", () => {
  const question: Pending = {
    kind: "question",
    id: "toolu_q",
    text: "Which pet?",
    multiSelect: false,
    allowsText: true,
    options: [{ label: "Cats" }, { label: "Dogs" }],
  };

  it("pending.answer writes keystrokes and acks; unknown pendingId → error not_found", async () => {
    const { session, pty } = await h.session("claude");
    h.registry.signal(session.id, { kind: "pending", pending: question });
    const c = await h.client();
    const before = pty.written.length;

    const answer = { type: "pending.answer", sessionId: session.id, pendingId: "toolu_q" };
    expect(await c.request({ ...answer, choiceIndices: [1] })).toMatchObject({ type: "ack" });
    expect(pty.written.slice(before).map(String)).toEqual(["2"]);

    expect(await c.request({ ...answer, pendingId: "other" })).toMatchObject({
      type: "error",
      code: "not_found",
    });
    expect(await c.request({ ...answer, decision: "allow" })).toMatchObject({
      type: "error",
      code: "bad_request",
    });
    expect(await c.request({ ...answer, sessionId: "s_none", choiceIndices: [0] })).toMatchObject({
      type: "error",
      code: "not_found",
    });
    h.registry.signal(session.id, { kind: "pending_cleared" });
    expect(await c.request({ ...answer, choiceIndices: [0] })).toMatchObject({
      type: "error",
      code: "not_found",
    });
    expect(pty.written.slice(before).map(String)).toEqual(["2"]);
  });

  it("writes a multi-chunk answer one chunk at a time, in order, and acks after the last", async () => {
    const { session, pty } = await h.session("claude");
    h.registry.signal(session.id, { kind: "pending", pending: question });
    const c = await h.client();
    const before = pty.written.length;
    const reply = await c.request({
      type: "pending.answer",
      sessionId: session.id,
      pendingId: "toolu_q",
      text: "Ferrets",
    });
    expect(reply).toMatchObject({ type: "ack" });
    // The "Type something" row's digit, then the text: two separate writes.
    expect(pty.written.slice(before).map(String)).toEqual(["3", "Ferrets\r"]);
  });

  it("answering an ended session → session_ended", async () => {
    const { session, pty } = await h.session("claude");
    h.registry.signal(session.id, { kind: "pending", pending: question });
    pty.emitExit(1);
    const c = await h.client();
    const reply = await c.request({
      type: "pending.answer",
      sessionId: session.id,
      pendingId: "toolu_q",
      choiceIndices: [0],
    });
    expect(reply).toMatchObject({ type: "error", code: "session_ended" });
  });
});
