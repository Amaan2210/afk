import type { ServerMessage, Session } from "../../protocol/index.js";
import type { ChatHub } from "../agents/hub.js";
import type { PtySnapshot } from "../sessions/session-process.js";
import type { NotifyKind } from "../sessions/state.js";

/** Terminal bytes travel as base64 in `data` fields, both ways. */
export function toBase64(bytes: Buffer): string {
  return bytes.toString("base64");
}

export function fromBase64(data: string): Buffer {
  return Buffer.from(data, "base64");
}

export function ptyDataFrame(sessionId: string, chunk: Buffer): ServerMessage {
  return { type: "pty.data", sessionId, data: toBase64(chunk) };
}

export function ptySnapshotFrame(sessionId: string, snap: PtySnapshot): ServerMessage {
  return {
    type: "pty.snapshot",
    sessionId,
    cols: snap.cols,
    rows: snap.rows,
    data: toBase64(snap.data),
  };
}

export function chatSnapshotFrame(
  hub: ChatHub,
  sessionId: string,
  threadId: string,
): ServerMessage {
  return { type: "chat.snapshot", sessionId, threadId, events: hub.history(sessionId, threadId) };
}

const TITLES: Record<NotifyKind, (name: string) => string> = {
  needs_input: (name) => `${name} needs your input`,
  finished: (name) => `${name} finished`,
  subagent_finished: (name) => `${name}: sub-agent finished`,
};

/** A notification: a question's text or a permission's summary, else the last message. */
export function notifyFrame(kind: NotifyKind, session: Session): ServerMessage {
  const frame = {
    type: "notify" as const,
    event: kind,
    sessionId: session.id,
    sessionName: session.name,
    title: TITLES[kind](session.name),
    body: session.lastMessage ?? "",
  };
  const { pending } = session;
  if (kind !== "needs_input" || pending === undefined) return frame;
  const body = pending.kind === "question" ? pending.text : pending.summary;
  return { ...frame, body, pending };
}
