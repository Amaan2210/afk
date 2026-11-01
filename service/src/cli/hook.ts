import type { Readable } from "node:stream";
import { portFromEnv, type PostFn } from "./post.js";
import { parseJson, readStdin, STDIN_CAP_MS, STDIN_IDLE_MS, type StdinCut } from "./read-stdin.js";
import { runUserNotify, type NotifySpawn } from "./user-notify.js";

export interface HookIo {
  stdin: Readable;
  env: NodeJS.ProcessEnv;
  post: PostFn;
  /** Arguments after the event name; `codex-notify` takes its JSON from the last one. */
  args?: string[];
  /** Starts the user's own Codex notify program (default: detached, see user-notify.ts). */
  spawnNotify?: NotifySpawn;
}

/**
 * The relay's whole run must stay under 2 s, the most an agent should wait on a hook. Reading
 * stdin takes at most STDIN_CAP_MS (1 s) and the post at most POST_TIMEOUT_MS (0.7 s), which
 * leaves 0.3 s for node and the CLI to start: `afk --version` measured about 0.21 s, with the
 * commands loaded lazily (src/cli/program.ts). A post that times out has usually been delivered:
 * the daemon answers after it has applied the hook.
 */
const POST_TIMEOUT_MS = 700;
const NOT_JSON = "not valid JSON";

function cutReason(why: StdinCut, bytes: number): string {
  return why === "idle"
    ? `no input for ${STDIN_IDLE_MS} ms after ${bytes} bytes`
    : `still open after ${STDIN_CAP_MS} ms with ${bytes} bytes`;
}

async function relay(event: string, sessionId: string, io: HookIo): Promise<void> {
  let cut: string | undefined;
  const raw =
    event === "codex-notify"
      ? (io.args?.at(-1) ?? "")
      : await readStdin(io.stdin, { onCut: (why, bytes) => (cut = cutReason(why, bytes)) });
  const parsed = parseJson(raw);
  const [route, body] =
    parsed === undefined
      ? ["/hooks/dropped", { event, reason: cut === undefined ? NOT_JSON : `${cut}, ${NOT_JSON}` }]
      : [event === "codex-notify" ? "/hooks/codex" : `/hooks/claude/${event}`, parsed];
  await io.post(portFromEnv(io.env), route, body, { "X-AFK-Session": sessionId }, POST_TIMEOUT_MS);
}

/**
 * Relays one agent hook to the daemon. Prints nothing on stdout (Claude Code may interpret it) and
 * always returns 0: a missing session or a down daemon is silently dropped. A payload that is not
 * valid JSON (or was cut off) is not relayed; the daemon is told why instead, and logs it at debug
 * level (`afk daemon --verbose`).
 *
 * `codex-notify` then runs the user's own Codex `notify` program, which AFK's notify replaced for
 * the session, with the same JSON.
 */
export async function runHook(event: string, io: HookIo): Promise<0> {
  try {
    const sessionId = io.env.AFK_SESSION_ID;
    if (sessionId) await relay(event, sessionId, io);
  } catch {
    // A relay never fails the agent.
  }
  const payload = io.args?.at(-1);
  if (event === "codex-notify" && payload !== undefined) {
    await runUserNotify(payload, { env: io.env, spawn: io.spawnNotify });
  }
  return 0;
}
