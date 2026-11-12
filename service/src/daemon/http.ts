import type { IncomingMessage, ServerResponse } from "node:http";
import type pino from "pino";
import { isRecord } from "../util/is-record.js";
import type { ChatHub } from "./agents/hub.js";
import { CodexLocator } from "./http-codex-locate.js";
import {
  agentExit,
  agentStart,
  claudeHook,
  codexNotify,
  hookDropped,
  HttpError,
  statusline,
  type RouteHandler,
} from "./http-routes.js";
import type { SessionRegistry } from "./sessions/registry.js";

export interface HttpDeps {
  registry: SessionRegistry;
  hub: ChatHub;
  version: string;
  codexSessionsDir: string;
  log: pino.Logger;
  startedAt: number;
  /** Decides whether a peer address may use the relays; defaults to the loopback addresses. */
  isLoopback?: (remoteAddress: string | undefined) => boolean;
  /** Codex rollout locate loop timing after `agent-start` (defaults 2000 / 30000 ms). */
  locateIntervalMs?: number;
  locateTimeoutMs?: number;
  /** Whether a phone is showing this session's terminal now. */
  phoneWatching?: (sessionId: string) => boolean;
  /** Clock for the agent-start time a rollout must not predate. */
  now?: () => Date;
}

/** The request listener; call `dispose()` to cancel pending Codex locate timers. */
export type HttpHandler = ((req: IncomingMessage, res: ServerResponse) => void) & {
  dispose(): void;
};

const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Where a route reads the session id from. */
type SessionSource = "header" | "path" | "none";

interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  session: SessionSource;
  handler: RouteHandler;
}

/** Every route in one place; see protocol.md "Loopback HTTP". */
const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/health$/, session: "none", handler: () => undefined },
  {
    method: "POST",
    pattern: /^\/hooks\/claude\/(?<event>[^/]+)$/,
    session: "header",
    handler: claudeHook,
  },
  { method: "POST", pattern: /^\/hooks\/codex$/, session: "header", handler: codexNotify },
  { method: "POST", pattern: /^\/hooks\/dropped$/, session: "header", handler: hookDropped },
  { method: "POST", pattern: /^\/statusline$/, session: "header", handler: statusline },
  {
    method: "POST",
    pattern: /^\/sessions\/(?<id>[^/]+)\/agent-start$/,
    session: "path",
    handler: agentStart,
  },
  {
    method: "POST",
    pattern: /^\/sessions\/(?<id>[^/]+)\/agent-exit$/,
    session: "path",
    handler: agentExit,
  },
];

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  if (res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

/** Reads and parses a JSON object body of at most 1 MB. */
async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "bad_request", "body too large");
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "body is not valid JSON");
  }
  if (!isRecord(parsed)) throw new HttpError(400, "bad_request", "body must be a JSON object");
  return parsed;
}

function findRoute(method: string, path: string) {
  for (const route of ROUTES) {
    const match = route.method === method ? route.pattern.exec(path) : null;
    if (match) return { route, params: { ...match.groups } };
  }
  return undefined;
}

export function createHttpHandler(deps: HttpDeps): HttpHandler {
  const { registry, log } = deps;
  const isLoopback = deps.isLoopback ?? ((addr) => addr !== undefined && LOOPBACK.has(addr));
  const locator = new CodexLocator({
    registry,
    hub: deps.hub,
    log,
    sessionsDir: deps.codexSessionsDir,
    intervalMs: deps.locateIntervalMs ?? 2000,
    timeoutMs: deps.locateTimeoutMs ?? 30_000,
    now: deps.now ?? (() => new Date()),
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopback(req.socket.remoteAddress)) throw new HttpError(403, "forbidden");
    const method = req.method ?? "";
    const path = (req.url ?? "").split("?")[0] ?? "";
    const found = findRoute(method, path);
    if (!found) throw new HttpError(404, "not_found");
    const { route, params } = found;

    if (route.session === "none") {
      const uptimeSec = Math.floor((Date.now() - deps.startedAt) / 1000);
      return sendJson(res, 200, { ok: true, version: deps.version, uptimeSec });
    }

    const header = req.headers["x-afk-session"];
    if (route.session === "header" && (typeof header !== "string" || header === "")) {
      throw new HttpError(400, "bad_request", "missing X-AFK-Session header");
    }
    const sessionId = route.session === "header" ? String(header) : (params.id ?? "");
    const record = registry.get(sessionId);
    if (!record) throw new HttpError(404, "not_found", `unknown session: ${sessionId}`);

    const body = await readJsonObject(req);
    // Late hooks from a dying process are expected and harmless.
    if (record.session.state === "ended") {
      log.debug({ route: `${method} ${path}`, sessionId }, "relay ignored: session ended");
      return sendJson(res, 200, {});
    }
    log.debug({ route: `${method} ${path}`, sessionId }, "relay");
    const result = await route.handler({ deps, locator, sessionId, params, body });
    sendJson(res, 200, result ?? {});
  }

  const handler = ((req, res) => {
    // Captured now: leaving the body loop early destroys `req`, which detaches its socket.
    const { socket } = req;
    handle(req, res).catch((err: unknown) => {
      const route = `${req.method ?? ""} ${req.url ?? ""}`;
      const sessionId = req.headers["x-afk-session"];
      if (err instanceof HttpError) {
        log.warn({ route, sessionId, status: err.status, reason: err.message }, "relay rejected");
        const withMessage = err.code === "bad_request";
        sendJson(
          res,
          err.status,
          withMessage ? { error: err.code, message: err.message } : { error: err.code },
          err.status === 413 ? { Connection: "close" } : {},
        );
        if (err.status === 413) res.once("finish", () => socket.destroy());
        return;
      }
      log.error({ err, route, sessionId }, "relay failed");
      sendJson(res, 500, { error: "internal" });
    });
  }) as HttpHandler;
  handler.dispose = () => locator.dispose();
  return handler;
}
