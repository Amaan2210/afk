import { ZodError } from "zod";
import { isClientType, type ErrorCode } from "../../protocol/index.js";
import { isRecord } from "../../util/is-record.js";

/** An error that reaches the client with its own code. */
export class WsError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new WsError("bad_request", message);
export const notFound = (message: string) => new WsError("not_found", message);

/** Errors thrown by the registry, fs and devices carry their code as a message prefix. */
const PREFIXED = /^(bad_request|not_found):\s*/;

/**
 * The code and message a thrown value is reported with. Anything that is not a `WsError` or a
 * prefixed `Error` is a bug and reported as `internal`, without its details.
 */
export function toWireError(err: unknown): { code: ErrorCode; message: string } {
  if (err instanceof WsError) return { code: err.code, message: err.message };
  if (err instanceof Error) {
    const prefix = PREFIXED.exec(err.message);
    if (prefix) {
      return { code: prefix[1] as ErrorCode, message: err.message.slice(prefix[0].length) };
    }
  }
  return { code: "internal", message: "internal error" };
}

/** Why a frame failed validation, in a line. */
export function describeInvalid(raw: unknown, err: unknown): string {
  if (!isRecord(raw)) return "a frame must be a JSON object";
  if (typeof raw.type !== "string" || !isClientType(raw.type)) {
    return `unknown message type ${JSON.stringify(raw.type)}`;
  }
  const issue = err instanceof ZodError ? err.issues[0] : undefined;
  if (issue === undefined) return `invalid ${raw.type}`;
  return `invalid ${raw.type}: ${issue.path.join(".")} ${issue.message}`.trim();
}
