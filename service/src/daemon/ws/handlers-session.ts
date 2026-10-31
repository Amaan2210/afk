import { stat } from "node:fs/promises";
import { badRequest } from "./errors.js";
import type { HandlerMap } from "./handlers.js";

type SessionType = "session.create" | "session.kill" | "session.resume" | "session.rename";

async function requireFolder(cwd: string): Promise<void> {
  const info = await stat(cwd).catch(() => undefined);
  if (!info?.isDirectory()) throw badRequest(`${cwd} is not a folder`);
}

export const sessionHandlers: Pick<HandlerMap, SessionType> = {
  async "session.create"(conn, msg, { deps }) {
    const { cwd, kind, args, name, prompt } = msg;
    await requireFolder(cwd);
    const session = await deps.registry.create({ cwd, kind, args, name, prompt });
    // The session exists either way: failing the request now would invite a duplicate on retry.
    await deps.recent
      .add(cwd)
      .catch((err: unknown) => deps.log.warn({ err, cwd }, "ws: recent folder not saved"));
    conn.ack(msg.id, { sessionId: session.id });
  },

  "session.kill"(conn, msg, { deps }) {
    deps.registry.kill(msg.sessionId);
    conn.ack(msg.id);
  },

  "session.rename"(conn, msg, { deps }) {
    deps.registry.rename(msg.sessionId, msg.name);
    conn.ack(msg.id);
  },

  async "session.resume"(conn, msg, { deps }) {
    const session = await deps.registry.resume(msg.sessionId);
    conn.ack(msg.id, { sessionId: session.id });
  },
};
