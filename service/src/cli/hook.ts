import type { Readable } from "node:stream";
import { portFromEnv, type PostFn } from "./post.js";
import { parseJson, readStdin } from "./read-stdin.js";

export interface HookIo {
  stdin: Readable;
  env: NodeJS.ProcessEnv;
  post: PostFn;
  /** Arguments after the event name; `codex-notify` takes its JSON from the last one. */
  args?: string[];
}

/** Total wall time stays under 2 s: stdin read (0.5 s) plus the post (1.2 s). */
const POST_TIMEOUT_MS = 1200;

/**
 * Relays one agent hook to the daemon. Prints nothing (Claude Code may interpret stdout) and
 * always returns 0: a missing session, malformed JSON or a down daemon is silently dropped.
 */
export async function runHook(event: string, io: HookIo): Promise<0> {
  try {
    const sessionId = io.env.AFK_SESSION_ID;
    if (!sessionId) return 0;
    const raw = event === "codex-notify" ? (io.args?.at(-1) ?? "") : await readStdin(io.stdin);
    const body = parseJson(raw);
    if (body === undefined) return 0;
    const route = event === "codex-notify" ? "/hooks/codex" : `/hooks/claude/${event}`;
    await io.post(
      portFromEnv(io.env),
      route,
      body,
      { "X-AFK-Session": sessionId },
      POST_TIMEOUT_MS,
    );
  } catch {
    // A relay never fails the agent.
  }
  return 0;
}
