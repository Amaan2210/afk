import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.stop();
});

describe("sessions", () => {
  it("session.create → ack{sessionId} and a session.updated broadcast to a second client", async () => {
    const a = await h.client();
    const b = await h.client();
    const reply = await a.request({
      type: "session.create",
      cwd: h.dir,
      kind: "claude",
      args: ["--model", "opus"],
      name: "api",
      prompt: "fix the tests",
    });
    expect(reply).toEqual({ type: "ack", id: reply.id, sessionId: expect.stringMatching(/^s_/) });
    const sessionId = reply.type === "ack" ? reply.sessionId : undefined;
    const updated = await b.next("session.updated", (u) => u.session.id === sessionId);
    expect(updated.session).toMatchObject({ name: "api", kind: "claude", cwd: h.dir });
    expect(await h.recent.list()).toEqual([h.dir]);
  });

  it("session.create with args for a shell → bad_request", async () => {
    const c = await h.client();
    const reply = await c.request({
      type: "session.create",
      cwd: h.dir,
      kind: "shell",
      args: ["x"],
    });
    expect(reply).toEqual({
      type: "error",
      id: reply.id,
      code: "bad_request",
      message: "a shell session takes no args or prompt",
    });
  });

  it("session.create in a folder that does not exist, or in a file, → bad_request", async () => {
    const file = join(h.dir, "notes.txt");
    await writeFile(file, "x");
    const c = await h.client();
    for (const cwd of [join(h.dir, "missing"), file]) {
      expect(await c.request({ type: "session.create", cwd, kind: "shell", args: [] })).toEqual({
        type: "error",
        id: expect.any(String),
        code: "bad_request",
        message: `${cwd} is not a folder`,
      });
    }
    expect(h.registry.list()).toEqual([]);
  });

  it("session.create still acks when the folder cannot be remembered", async () => {
    vi.spyOn(h.recent, "add").mockRejectedValue(new Error("disk full"));
    const c = await h.client();
    const reply = await c.request({ type: "session.create", cwd: h.dir, kind: "shell", args: [] });
    expect(reply).toMatchObject({ type: "ack", sessionId: expect.any(String) });
    expect(h.logs).toContainEqual(expect.objectContaining({ level: 40 }));
  });

  it("session.rename acks and broadcasts the new name; session.kill on an unknown id → error not_found; session.resume of an ended session acks with a new sessionId", async () => {
    const { session, pty } = await h.session("claude");
    const a = await h.client();
    const b = await h.client();

    expect(
      await a.request({ type: "session.rename", sessionId: session.id, name: "renamed" }),
    ).toMatchObject({ type: "ack" });
    await b.next("session.updated", (u) => u.session.name === "renamed");

    const missing = await a.request({ type: "session.kill", sessionId: "s_none" });
    expect(missing).toEqual({
      type: "error",
      id: missing.id,
      code: "not_found",
      message: "no session s_none",
    });

    expect(await a.request({ type: "session.kill", sessionId: session.id })).toMatchObject({
      type: "ack",
    });
    expect(pty.killed).toBe(true);

    h.registry.setMeta(session.id, { agentSessionId: "claude-conv-1" });
    pty.emitExit(0);
    const resumed = await a.request({ type: "session.resume", sessionId: session.id });
    expect(resumed).toMatchObject({ type: "ack", sessionId: expect.stringMatching(/^s_/) });
    const newId = resumed.type === "ack" ? resumed.sessionId : undefined;
    expect(newId).not.toBe(session.id);
    await b.next("session.updated", (u) => u.session.id === newId);
  });

  it("session.resume on a session without agentSessionId → error bad_request", async () => {
    const { session, pty } = await h.session("claude");
    pty.emitExit(0);
    const c = await h.client();
    expect(await c.request({ type: "session.resume", sessionId: session.id })).toMatchObject({
      type: "error",
      code: "bad_request",
      message: `session ${session.id} has no agent conversation to resume`,
    });
  });

  it("a removed session is broadcast as session.removed", async () => {
    const { session, pty } = await h.session();
    const c = await h.client();
    pty.emitExit(0);
    const ended = h.registry.get(session.id)?.session;
    if (ended?.endedAt === undefined) throw new Error("session did not end");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(ended.endedAt) + 25 * 3_600_000);
    h.registry.pruneEnded();
    vi.useRealTimers();
    expect(await c.next("session.removed")).toEqual({
      type: "session.removed",
      sessionId: session.id,
    });
  });
});
