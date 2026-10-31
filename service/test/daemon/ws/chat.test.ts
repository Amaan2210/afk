import type { Pending, Strip } from "../../../src/protocol/index.js";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;
const permission: Pending = { kind: "permission", id: "perm-1", tool: "Bash", summary: "npm test" };
const strip: Strip = { at: "2026-10-31T10:00:00.000Z", contextUsedPct: 42 };

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  await h.stop();
});

describe("chat", () => {
  it("chat.subscribe → chat.snapshot then chat.event", async () => {
    const { session } = await h.session("claude");
    h.registry.signal(session.id, { kind: "turn_start" }); // history: turn-1
    const c = await h.client();

    const reply = await c.request({ type: "chat.subscribe", sessionId: session.id });
    expect(reply).toEqual({ type: "ack", id: reply.id });
    const snapshot = await c.next("chat.snapshot");
    expect(snapshot).toEqual({
      type: "chat.snapshot",
      sessionId: session.id,
      threadId: "main",
      events: h.hub.history(session.id, "main"),
    });
    expect(snapshot.events.map((e) => e.id)).toEqual(["turn-1"]);

    h.registry.signal(session.id, { kind: "pending", pending: permission });
    const event = await c.next("chat.event");
    expect(event).toMatchObject({
      sessionId: session.id,
      threadId: "main",
      event: { id: "perm-1", kind: "permission", pending: permission },
    });
    const order = c.types().filter((t) => ["ack", "chat.snapshot", "chat.event"].includes(t));
    expect(order).toEqual(["ack", "chat.snapshot", "chat.event"]);
  });

  it("delivers only the subscribed thread, and nothing after chat.unsubscribe", async () => {
    const { session } = await h.session("claude");
    const c = await h.client();
    await c.request({ type: "chat.subscribe", sessionId: session.id, threadId: "agent-1" });
    expect(await c.next("chat.snapshot")).toMatchObject({ threadId: "agent-1", events: [] });

    h.registry.signal(session.id, { kind: "turn_start" }); // a main-thread event
    await c.sync();
    expect(c.of("chat.event")).toEqual([]);

    await c.request({ type: "chat.subscribe", sessionId: session.id });
    c.send({ type: "chat.unsubscribe", sessionId: session.id });
    await c.sync();
    h.registry.signal(session.id, { kind: "turn_end" });
    await c.sync();
    expect(c.of("chat.event")).toEqual([]);
  });

  it("chat.subscribe on an unknown session → not_found", async () => {
    const c = await h.client();
    expect(await c.request({ type: "chat.subscribe", sessionId: "s_none" })).toMatchObject({
      type: "error",
      code: "not_found",
    });
  });

  it("re-sends chat.snapshot to a thread's subscribers when the hub resets it", async () => {
    const { session } = await h.session("claude");
    h.registry.signal(session.id, { kind: "turn_start" });
    h.hub.attachClaude(session.id, `${h.dir}/first.jsonl`); // no file yet: nothing is read
    const c = await h.client();
    await c.request({ type: "chat.subscribe", sessionId: session.id });
    expect((await c.next("chat.snapshot")).events).toHaveLength(1);

    // Another file: the hub clears the session's history and says so.
    h.hub.attachClaude(session.id, `${h.dir}/second.jsonl`);
    await vi.waitFor(() => expect(c.of("chat.snapshot")).toHaveLength(2));
    expect(c.of("chat.snapshot")[1]).toEqual({
      type: "chat.snapshot",
      sessionId: session.id,
      threadId: "main",
      events: [],
    });
  });
});

describe("strip.update", () => {
  it("goes to pty and chat subscribers of the session only", async () => {
    const { session } = await h.session("claude");
    const { session: other } = await h.session("claude");
    const viaPty = await h.client();
    const viaChat = await h.client();
    const elsewhere = await h.client();
    const bystander = await h.client();
    await viaPty.request({ type: "pty.subscribe", sessionId: session.id, cols: 120, rows: 30 });
    await viaChat.request({ type: "chat.subscribe", sessionId: session.id, threadId: "agent-1" });
    await elsewhere.request({ type: "chat.subscribe", sessionId: other.id });

    h.hub.updateStrip(session.id, strip);
    const expected = { type: "strip.update", sessionId: session.id, strip };
    expect(await viaPty.next("strip.update")).toEqual(expected);
    expect(await viaChat.next("strip.update")).toEqual(expected);
    await elsewhere.sync();
    await bystander.sync();
    expect(elsewhere.of("strip.update")).toEqual([]);
    expect(bystander.of("strip.update")).toEqual([]);
  });

  it("chat.subscribe sends the session's latest strip after the snapshot", async () => {
    const { session } = await h.session("claude");
    const c = await h.client();
    await c.request({ type: "chat.subscribe", sessionId: session.id });
    await c.sync();
    expect(c.of("strip.update")).toEqual([]); // none yet

    h.hub.updateStrip(session.id, strip);
    const late = await h.client();
    await late.request({ type: "chat.subscribe", sessionId: session.id });
    await late.next("strip.update");
    expect(late.types().slice(-3)).toEqual(["ack", "chat.snapshot", "strip.update"]);
    expect(late.of("strip.update")[0].strip).toEqual(strip);
  });
});
