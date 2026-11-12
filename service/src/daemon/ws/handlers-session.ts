import { stat } from "node:fs/promises";
import { requireLocalPath } from "../fs.js";
import { badRequest, WsError } from "./errors.js";
import type { HandlerMap } from "./handlers.js";

type SessionType = "session.create" | "session.kill" | "session.resume" | "session.rename";

/** Longest session name, in characters. */
const MAX_NAME = 64;

/** C0 controls, DEL and C1 controls. */
function hasControlChar(text: string): boolean {
  return [...text].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 0x20 || (c >= 0x7f && c <= 0x9f);
  });
}

/** A name from a client: trimmed and capped at 64 characters; "" when blank. */
function sessionName(raw: string): string {
  const name = raw.trim();
  if (hasControlChar(name)) throw badRequest("name must not contain control characters");
  return [...name].slice(0, MAX_NAME).join("").trimEnd();
}

/**
 * Only a folder that is missing (or a file) is the client's mistake; any other failure to read it
 * is reported as the daemon's, with its code.
 */
async function requireFolder(cwd: string): Promise<void> {
  requireLocalPath(cwd, "cwd");
  let isFolder: boolean;
  try {
    isFolder = (await stat(cwd)).isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw new WsError("internal", `cannot read ${cwd} (${code ?? "unknown error"})`);
    }
    isFolder = false;
  }
  if (!isFolder) throw badRequest(`${cwd} is not a folder`);
}

export const sessionHandlers: Pick<HandlerMap, SessionType> = {
  async "session.create"(conn, msg, { deps }) {
    const { cwd, kind, args, prompt } = msg;
    // A blank name falls back to the folder's.
    const name = (msg.name === undefined ? "" : sessionName(msg.name)) || undefined;
    await requireFolder(cwd);
    const session = await deps.registry.create({ cwd, kind, args, name, prompt });
    // The session exists either way: failing the request now would invite a duplicate on retry.
    await deps.recent
      .add(cwd)
      .catch((err: unknown) => deps.log.warn({ err, cwd }, "ws: recent folder not saved"));
    // The CLI attaches its own window; a session from the phone gets one here.
    if (!conn.isLocal) deps.openWindow?.(session.id);
    conn.ack(msg.id, { sessionId: session.id });
  },

  "session.kill"(conn, msg, { deps }) {
    deps.registry.kill(msg.sessionId);
    conn.ack(msg.id);
  },

  "session.rename"(conn, msg, { deps }) {
    const name = sessionName(msg.name);
    if (name === "") throw badRequest("name must not be empty");
    deps.registry.rename(msg.sessionId, name);
    conn.ack(msg.id);
  },

  async "session.resume"(conn, msg, { deps }) {
    const session = await deps.registry.resume(msg.sessionId);
    if (!conn.isLocal) deps.openWindow?.(session.id);
    conn.ack(msg.id, { sessionId: session.id });
  },
};
