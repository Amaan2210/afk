import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  SessionSchema,
  parseClientMessage,
  parseServerMessage,
} from "../../src/protocol/index.js";

describe("client messages", () => {
  it("parses a session.create message", () => {
    const m = parseClientMessage({
      type: "session.create",
      id: "r1",
      cwd: "D:\\p",
      kind: "claude",
      args: ["--dangerously-skip-permissions"],
    });
    expect(m.type).toBe("session.create");
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      parseClientMessage({
        type: "session.create",
        id: "r1",
        cwd: "D:\\p",
        kind: "gemini",
        args: [],
      }),
    ).toThrow();
  });

  it("requires id on requests that expect a reply", () => {
    expect(() => parseClientMessage({ type: "session.kill", sessionId: "s_1" })).toThrow();
  });

  it("rejects an unknown message type", () => {
    expect(() => parseClientMessage({ type: "nope" })).toThrow();
  });

  it("accepts fire-and-forget messages without id", () => {
    expect(parseClientMessage({ type: "pty.input", sessionId: "s_1", data: "aGk=" }).type).toBe(
      "pty.input",
    );
  });

  it("rejects a bad pending.answer decision", () => {
    expect(() =>
      parseClientMessage({
        type: "pending.answer",
        id: "r2",
        sessionId: "s_1",
        pendingId: "q1",
        decision: "maybe",
      }),
    ).toThrow();
  });
});

describe("server messages", () => {
  it("accepts an ack with extra result fields", () => {
    const m = parseServerMessage({ type: "ack", id: "r1", sessionId: "s_1" });
    expect(m).toMatchObject({ type: "ack", sessionId: "s_1" });
  });

  it("rejects an error with an unknown code", () => {
    expect(() => parseServerMessage({ type: "error", code: "boom", message: "x" })).toThrow();
  });
});

describe("shared types", () => {
  it("accepts a Session with pending question", () => {
    const s = SessionSchema.parse({
      id: "s_abc",
      name: "p",
      cwd: "D:\\p",
      kind: "claude",
      state: "needs_input",
      createdAt: "2026-10-30T13:00:00.000Z",
      lastActivityAt: "2026-10-30T13:00:00.000Z",
      subagentsRunning: 0,
      pending: {
        kind: "question",
        id: "q1",
        text: "Which?",
        multiSelect: false,
        allowsText: true,
        options: [{ label: "A", recommended: true }, { label: "B" }],
      },
    });
    expect(s.pending?.kind).toBe("question");
  });

  it("rejects a Session missing subagentsRunning", () => {
    expect(() =>
      SessionSchema.parse({
        id: "s_abc",
        name: "p",
        cwd: "D:\\p",
        kind: "shell",
        state: "idle",
        createdAt: "2026-10-30T13:00:00.000Z",
        lastActivityAt: "2026-10-30T13:00:00.000Z",
      }),
    ).toThrow();
  });
});

it("exposes constants", () => {
  expect(PROTOCOL_VERSION).toBe(1);
  expect(DEFAULT_PORT).toBe(2350);
});
