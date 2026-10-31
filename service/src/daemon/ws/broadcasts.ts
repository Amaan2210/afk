import type { ChatMessage } from "../agents/hub.js";
import type { Session, Stats, Strip } from "../../protocol/index.js";
import type { NotifyKind } from "../sessions/state.js";
import type { WsContext } from "./context.js";
import { chatSnapshotFrame, notifyFrame, ptyDataFrame } from "./frames.js";

/**
 * Forwards the registry's, hub's and stats sampler's events to the clients that want them, and
 * returns a function that stops. A listener never throws back into the emitter: a failure is
 * logged, and each client's send is already isolated from the others'.
 */
export function wireBroadcasts(ctx: WsContext): () => void {
  const { registry, hub, stats, log } = ctx.deps;

  function guard<A extends unknown[]>(event: string, fn: (...args: A) => void) {
    return (...args: A): void => {
      try {
        fn(...args);
      } catch (err) {
        log.warn({ err, event }, "ws: event not forwarded");
      }
    };
  }

  const updated = guard("updated", (session: Session) =>
    ctx.broadcast({ type: "session.updated", session }),
  );
  const removed = guard("removed", (sessionId: string) => {
    for (const c of ctx.clients()) c.forget(sessionId);
    ctx.broadcast({ type: "session.removed", sessionId });
  });
  const notify = guard("notify", (n: { kind: NotifyKind; session: Session }) =>
    ctx.broadcast(notifyFrame(n.kind, n.session)),
  );
  const data = guard("data", (sessionId: string, chunk: Buffer) =>
    ctx.broadcast(ptyDataFrame(sessionId, chunk), (c) => c.pty.has(sessionId)),
  );
  // An ended session prints nothing more; its subscribers get its state from session.updated.
  const exit = guard("exit", (sessionId: string) => {
    for (const c of ctx.clients()) c.pty.delete(sessionId);
  });
  const chat = guard("chat", ({ sessionId, threadId, event }: ChatMessage) =>
    ctx.broadcast({ type: "chat.event", sessionId, threadId, event }, (c) =>
      c.watchesChat(sessionId, threadId),
    ),
  );
  const strip = guard("strip", (u: { sessionId: string; strip: Strip }) =>
    ctx.broadcast({ type: "strip.update", ...u }, (c) => c.watches(u.sessionId)),
  );
  // The thread's history was cleared and will be read again: subscribers start over from it.
  const reset = guard("reset", ({ sessionId, threadId }: { sessionId: string; threadId: string }) =>
    ctx.broadcast(chatSnapshotFrame(hub, sessionId, threadId), (c) =>
      c.watchesChat(sessionId, threadId),
    ),
  );
  const sample = guard("sample", (s: Stats) => {
    if (ctx.clients().length > 0) ctx.broadcast({ type: "stats", ...s });
  });

  registry.on("updated", updated);
  registry.on("removed", removed);
  registry.on("notify", notify);
  registry.on("data", data);
  registry.on("exit", exit);
  hub.on("chat", chat);
  hub.on("strip", strip);
  hub.on("reset", reset);
  stats.on("sample", sample);

  return () => {
    registry.off("updated", updated);
    registry.off("removed", removed);
    registry.off("notify", notify);
    registry.off("data", data);
    registry.off("exit", exit);
    hub.off("chat", chat);
    hub.off("strip", strip);
    hub.off("reset", reset);
    stats.off("sample", sample);
  };
}
