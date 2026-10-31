import { setTimeout as sleep } from "node:timers/promises";
import type { SessionRecord } from "../sessions/registry.js";
import { chunksForAnswer } from "../sessions/answer.js";
import type { SessionProcess } from "../sessions/session-process.js";
import type { ClientConn } from "./client-conn.js";
import type { WsContext } from "./context.js";
import { badRequest, notFound, WsError } from "./errors.js";
import { fromBase64, ptySnapshotFrame } from "./frames.js";
import type { HandlerMap } from "./handlers.js";

type PtyType = "pty.subscribe" | "pty.unsubscribe" | "pty.input" | "pty.resize" | "pending.answer";

const MAX_SIZE = 1000;

function sessionOf(ctx: WsContext, sessionId: string): SessionRecord {
  const record = ctx.deps.registry.get(sessionId);
  if (record === undefined) throw notFound(`no session ${sessionId}`);
  return record;
}

/** A session that has not ended; its keys and size can still change. */
function liveSessionOf(ctx: WsContext, sessionId: string): SessionRecord {
  const record = sessionOf(ctx, sessionId);
  if (record.session.state === "ended") {
    throw new WsError("session_ended", `session ${sessionId} has ended`);
  }
  return record;
}

function terminalOf(record: SessionRecord): SessionProcess {
  if (record.process === undefined) throw notFound(`session ${record.session.id} has no terminal`);
  return record.process;
}

function checkSize(cols: number, rows: number): void {
  if (cols < 1 || rows < 1 || cols > MAX_SIZE || rows > MAX_SIZE) {
    throw badRequest(`cols and rows must be 1-${MAX_SIZE}`);
  }
}

/** Resizes the pty and tells the session's other terminal subscribers; never echoes `by`. */
function resize(ctx: WsContext, by: ClientConn, record: SessionRecord, cols: number, rows: number) {
  const proc = terminalOf(record);
  const sessionId = record.session.id;
  if (proc.cols === cols && proc.rows === rows) return;
  proc.resize(cols, rows);
  ctx.broadcast(
    { type: "pty.resized", sessionId, cols, rows },
    (c) => c !== by && c.pty.has(sessionId),
  );
}

export const ptyHandlers: Pick<HandlerMap, PtyType> = {
  /**
   * The snapshot is taken and the subscription made in one synchronous step, so every chunk of
   * output is either in the snapshot or streamed after it. An ended session's last screen is sent
   * without a subscription.
   */
  "pty.subscribe"(conn, msg, ctx) {
    const { sessionId, cols, rows } = msg;
    checkSize(cols, rows);
    const record = sessionOf(ctx, sessionId);
    const proc = terminalOf(record);
    const live = record.session.state !== "ended";
    if (live) resize(ctx, conn, record, cols, rows);
    const snapshot = ptySnapshotFrame(sessionId, proc.snapshot());
    if (live) conn.pty.add(sessionId);
    conn.ack(msg.id);
    conn.send(snapshot);
  },

  "pty.unsubscribe"(conn, msg) {
    conn.pty.delete(msg.sessionId);
  },

  "pty.input"(_conn, msg, ctx) {
    liveSessionOf(ctx, msg.sessionId);
    ctx.deps.registry.input(msg.sessionId, fromBase64(msg.data));
  },

  "pty.resize"(conn, msg, ctx) {
    checkSize(msg.cols, msg.rows);
    resize(ctx, conn, liveSessionOf(ctx, msg.sessionId), msg.cols, msg.rows);
  },

  /** Types the answer's chunks with a pause between them, for the prompt to re-render. */
  async "pending.answer"(conn, msg, ctx) {
    const { sessionId, pendingId, choiceIndices, text, decision } = msg;
    const { session } = liveSessionOf(ctx, sessionId);
    const pending = session.pending;
    if (pending?.id !== pendingId) throw notFound(`no pending ${pendingId} on ${sessionId}`);
    const chunks = chunksForAnswer(session.kind, pending, { choiceIndices, text, decision });
    for (const [i, chunk] of chunks.entries()) {
      if (i > 0) await sleep(ctx.answerChunkDelayMs);
      liveSessionOf(ctx, sessionId);
      ctx.deps.registry.input(sessionId, chunk);
    }
    conn.ack(msg.id);
  },
};
