import type { Pending } from "../../../src/protocol/index.js";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness({ answerChunkDelayMs: 40 });
});

afterEach(async () => {
  await h.stop();
});

const question: Pending = {
  kind: "question",
  id: "toolu_q",
  text: "Which pet?",
  multiSelect: false,
  allowsText: true,
  options: [{ label: "Cats" }, { label: "Dogs" }],
};

/**
 * Answers `question` with free text (two chunks: "3", then "Ferrets\r") while `between` runs
 * right after the first chunk is typed, and returns the reply and what reached the terminal.
 */
async function answerWhile(between: (sessionId: string) => void) {
  const { session, pty } = await h.session("claude");
  h.registry.signal(session.id, { kind: "pending", pending: question });
  const write = pty.write.bind(pty);
  vi.spyOn(pty, "write").mockImplementation((data) => {
    write(data);
    if (String(data) === "3") setImmediate(() => between(session.id));
  });
  const c = await h.client();
  const before = pty.written.length;
  const reply = await c.request({
    type: "pending.answer",
    sessionId: session.id,
    pendingId: "toolu_q",
    text: "Ferrets",
  });
  await c.sync();
  return {
    reply,
    replies: c.replies(String(reply.id)),
    typed: pty.written.slice(before).map(String),
  };
}

describe("pending.answer when the pending changes mid-answer", () => {
  it("a new pending in its place stops the answer: pending_changed, nothing more typed", async () => {
    const r = await answerWhile((id) =>
      h.registry.signal(id, { kind: "pending", pending: { ...question, id: "toolu_q2" } }),
    );
    expect(r.reply).toMatchObject({
      type: "error",
      code: "pending_changed",
      message: "pending toolu_q changed while its answer was typed; the rest was not typed",
    });
    expect(r.replies).toHaveLength(1);
    expect(r.typed).toEqual(["3"]);
  });

  it("a pending that went away stops it too", async () => {
    const r = await answerWhile((id) => h.registry.signal(id, { kind: "pending_cleared" }));
    expect(r.reply).toMatchObject({ type: "error", code: "pending_changed" });
    expect(r.typed).toEqual(["3"]);
  });

  it("an unchanged pending is answered in full", async () => {
    const r = await answerWhile(() => undefined);
    expect(r.reply).toMatchObject({ type: "ack" });
    expect(r.typed).toEqual(["3", "Ferrets\r"]);
  });
});
