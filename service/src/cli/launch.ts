import type { SessionKind } from "../protocol/index.js";
import { attach, exitCodeFor, requireTty, type AttachClient, type AttachIo } from "./attach.js";
import { withDaemon, type ClientOptions, type RunDeps } from "./run.js";
import { SessionWatch } from "./session-watch.js";

export interface LaunchIo extends AttachIo {
  cwd: string;
  client: AttachClient;
  /** The session's name; the daemon defaults it to the folder's. */
  name?: string;
}

export interface LaunchOptions extends ClientOptions {
  name?: string;
}

export type LaunchRunner = (
  kind: SessionKind,
  args: string[],
  opts: LaunchOptions,
) => Promise<void>;

/**
 * Creates a session in `cwd` that runs `kind` with `args`, then attaches this terminal to it.
 * Resolves with 1 if the daemon went away, else the session's exit code.
 */
export async function launch(kind: SessionKind, args: string[], io: LaunchIo): Promise<number> {
  // Checked before the session exists: a refused launch must not leave one running.
  requireTty(io.stdin);
  const { client, cwd, name } = io;
  // The daemon announces the new session, with its name, before it acks the create.
  const watch = new SessionWatch(client);
  try {
    const create = { type: "session.create", cwd, kind, args, ...(name ? { name } : {}) };
    const { sessionId } = await client.request<{ sessionId: string }>(create);
    const outcome = await attach(client, sessionId, io, watch);
    return exitCodeFor(outcome, watch.get(sessionId));
  } finally {
    watch.stop();
  }
}

/**
 * `afk claude|codex|shell`; refuses without a terminal before connecting, and starts the daemon
 * when it is not running.
 */
export function runLaunch(
  kind: SessionKind,
  args: string[],
  opts: LaunchOptions,
  io: Omit<LaunchIo, "client" | "name"> = {
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
  },
  deps?: RunDeps,
): Promise<void> {
  const command = ({ client }: { client: AttachClient }) =>
    launch(kind, args, { ...io, client, name: opts.name });
  return withDaemon(opts, command, deps, () => requireTty(io.stdin), { autostart: true });
}
