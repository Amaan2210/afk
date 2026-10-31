import type { ClientMessage } from "../../protocol/index.js";
import type { ClientConn } from "./client-conn.js";
import type { WsContext } from "./context.js";
import { chatHandlers } from "./handlers-chat.js";
import { daemonHandlers } from "./handlers-daemon.js";
import { deviceHandlers } from "./handlers-devices.js";
import { ptyHandlers } from "./handlers-pty.js";
import { sessionHandlers } from "./handlers-session.js";

/** Every client message but `auth`, which the connection handles itself. */
export type RequestMessage = Exclude<ClientMessage, { type: "auth" }>;
export type RequestType = RequestMessage["type"];
export type MessageOf<T extends RequestType> = Extract<RequestMessage, { type: T }>;

/**
 * Handles one validated message from an authenticated client. A request is answered by the
 * handler (an ack or its result frame) or, when it throws, with the matching error; so a handler
 * does everything that can fail before it replies.
 */
export type Handler<T extends RequestType> = (
  conn: ClientConn,
  msg: MessageOf<T>,
  ctx: WsContext,
) => void | Promise<void>;

export type HandlerMap = { [T in RequestType]: Handler<T> };

/** One handler per message type, grouped by area in the handlers-*.ts files. */
const handlers: HandlerMap = {
  ...sessionHandlers,
  ...ptyHandlers,
  ...chatHandlers,
  ...daemonHandlers,
  ...deviceHandlers,
};

function handlerFor<T extends RequestType>(type: T): Handler<T> {
  return handlers[type];
}

export function dispatch(
  conn: ClientConn,
  msg: RequestMessage,
  ctx: WsContext,
): void | Promise<void> {
  return handlerFor(msg.type)(conn, msg, ctx);
}
