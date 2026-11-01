import { CLAUDE_HOOK_EVENTS } from "../launch/claude-settings.js";
import { mapClaudeHook } from "./agents/claude/hooks.js";
import { mapStatusline } from "./agents/claude/statusline.js";
import { findRolloutFile } from "./agents/codex/locate.js";
import { mapCodexNotify } from "./agents/codex/notify.js";
import { truncate } from "./agents/summarize.js";
import type { CodexLocator } from "./http-codex-locate.js";
import type { HttpDeps } from "./http.js";
import type { AgentSignal } from "./sessions/state.js";

/** A request the handler rejects with a specific status and protocol error code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface RouteContext {
  deps: HttpDeps;
  locator: CodexLocator;
  sessionId: string;
  /** Named groups of the route pattern. */
  params: Record<string, string>;
  body: Record<string, unknown>;
}

/** A route's work; its JSON response is `{}` unless it returns an object. */
export type RouteHandler = (ctx: RouteContext) => Record<string, unknown> | void | Promise<void>;

const MAX_LAST_MESSAGE = 200;

/** Flushes the transcript so earlier lines come first, then applies the signals in order. */
function applySignals({ deps, sessionId }: RouteContext, signals: AgentSignal[]): void {
  deps.hub.flush(sessionId);
  for (const signal of signals) {
    deps.registry.signal(
      sessionId,
      signal.kind === "turn_end" && signal.lastMessage !== undefined
        ? { kind: "turn_end", lastMessage: truncate(signal.lastMessage, MAX_LAST_MESSAGE - 1) }
        : signal,
    );
  }
}

export const claudeHook: RouteHandler = (ctx) => {
  const event = ctx.params.event ?? "";
  if (!(CLAUDE_HOOK_EVENTS as readonly string[]).includes(event)) {
    throw new HttpError(400, "bad_request", `unknown hook event: ${event}`);
  }
  const { signals, meta } = mapClaudeHook(event, ctx.body);
  if (meta) {
    const { agentSessionId, transcriptPath } = meta;
    ctx.deps.registry.setMeta(ctx.sessionId, {
      kind: "claude",
      ...(agentSessionId !== undefined && { agentSessionId }),
      ...(transcriptPath !== undefined && { transcriptPath }),
    });
    if (transcriptPath !== undefined) ctx.deps.hub.attachClaude(ctx.sessionId, transcriptPath);
  }
  applySignals(ctx, signals);
};

export const codexNotify: RouteHandler = async (ctx) => {
  const { registry, hub, codexSessionsDir } = ctx.deps;
  const { signals, meta } = mapCodexNotify(ctx.body);
  const threadId = meta?.agentSessionId;
  if (threadId !== undefined) {
    const before = registry.get(ctx.sessionId);
    const known =
      before?.session.agentSessionId === threadId && before.meta.rolloutPath !== undefined;
    registry.setMeta(ctx.sessionId, { agentSessionId: threadId });
    // The thread id is authoritative: it overrides whatever the early locate loop picked.
    const rollout = known ? undefined : await findRolloutFile(codexSessionsDir, { threadId });
    const record = registry.get(ctx.sessionId);
    if (record && rollout !== undefined && rollout !== record.meta.rolloutPath) {
      registry.setMeta(ctx.sessionId, { rolloutPath: rollout });
      hub.attachCodex(ctx.sessionId, rollout);
      ctx.locator.stop(ctx.sessionId);
    }
  }
  if (!registry.get(ctx.sessionId)) return;
  applySignals(ctx, signals);
};

/** A hook whose payload `afk hook` could not relay: logged at debug level, so `--verbose` shows it. */
export const hookDropped: RouteHandler = (ctx) => {
  const { event, reason } = ctx.body;
  if (typeof event !== "string" || typeof reason !== "string") {
    throw new HttpError(400, "bad_request", "event and reason must be strings");
  }
  ctx.deps.log.debug(
    { sessionId: ctx.sessionId, event: truncate(event, 100), reason: truncate(reason, 200) },
    "relay: a hook dropped its payload",
  );
};

export const statusline: RouteHandler = (ctx) => {
  ctx.deps.hub.updateStrip(ctx.sessionId, mapStatusline(ctx.body));
};

export const agentStart: RouteHandler = (ctx) => {
  const { kind } = ctx.body;
  if (kind !== "claude" && kind !== "codex") {
    throw new HttpError(400, "bad_request", 'kind must be "claude" or "codex"');
  }
  ctx.deps.registry.setMeta(ctx.sessionId, { kind });
  // A rollout from an earlier run in this shell is replaced when a newer one appears.
  if (kind === "codex") ctx.locator.start(ctx.sessionId);
  else ctx.locator.stop(ctx.sessionId);
};

export const agentExit: RouteHandler = (ctx) => {
  ctx.locator.stop(ctx.sessionId);
  ctx.deps.registry.signal(ctx.sessionId, { kind: "agent_exit" });
};
