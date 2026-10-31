import { MAIN_THREAD } from "../agents/hub-session.js";
import { notFound } from "./errors.js";
import { chatSnapshotFrame } from "./frames.js";
import type { HandlerMap } from "./handlers.js";

export const chatHandlers: Pick<HandlerMap, "chat.subscribe" | "chat.unsubscribe"> = {
  /** The thread's history, then its live events; the session's latest strip, if any, follows. */
  "chat.subscribe"(conn, msg, { deps }) {
    const { sessionId } = msg;
    const threadId = msg.threadId ?? MAIN_THREAD;
    if (deps.registry.get(sessionId) === undefined) throw notFound(`no session ${sessionId}`);
    const snapshot = chatSnapshotFrame(deps.hub, sessionId, threadId);
    const strip = deps.hub.latestStrip(sessionId);
    conn.subscribeChat(sessionId, threadId);
    conn.ack(msg.id);
    conn.send(snapshot);
    if (strip !== undefined) conn.send({ type: "strip.update", sessionId, strip });
  },

  "chat.unsubscribe"(conn, msg) {
    conn.unsubscribeChat(msg.sessionId, msg.threadId ?? MAIN_THREAD);
  },
};
