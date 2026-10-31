import { ClientMessageSchema, type ClientMessage } from "./client.js";
import { ServerMessageSchema, type ServerMessage } from "./server.js";

export * from "./shared.js";
export * from "./client.js";
export * from "./server.js";

/** Validate an untrusted frame from a client. Throws `ZodError` when invalid. */
export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw);
}

/** Validate an untrusted frame from the daemon. Throws `ZodError` when invalid. */
export function parseServerMessage(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw);
}
