import type { Command } from "commander";
import type { SessionKind } from "../protocol/index.js";
import { attach, exitCodeFor, requireTty, type AttachClient, type AttachIo } from "./attach.js";
import { parsePortOption, withDaemon, type ClientOptions } from "./run.js";
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
 * Resolves with 0 on detach, 1 if the daemon went away, else the session's exit code.
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

function runLaunch(kind: SessionKind, args: string[], opts: LaunchOptions): Promise<void> {
  return withDaemon(opts, ({ client }) =>
    launch(kind, args, {
      cwd: process.cwd(),
      client,
      name: opts.name,
      stdin: process.stdin,
      stdout: process.stdout,
    }),
  );
}

function launcher(program: Command, name: string, description: string): Command {
  return program
    .command(name)
    .description(description)
    .option("--name <name>", "the session's name (default: the folder's name)")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption);
}

/**
 * `afk claude` and `afk codex` pass every argument after their own options to the agent
 * untouched; `--name` and `--port` count only before the first agent argument. `afk shell` runs
 * no agent and takes no arguments.
 */
export function registerLaunchCommands(program: Command, run: LaunchRunner = runLaunch): void {
  for (const agent of ["claude", "codex"] as const) {
    launcher(program, agent, `start ${agent} in a new session in this folder and attach to it`)
      .argument(
        "[args...]",
        `${agent}'s own arguments, passed untouched; afk's options go first, and -- passes -h on`,
      )
      .allowUnknownOption()
      .passThroughOptions()
      .action((args: string[], opts: LaunchOptions) => run(agent, args, opts));
  }
  launcher(program, "shell", "start a shell session in this folder and attach to it").action(
    (opts: LaunchOptions) => run("shell", [], opts),
  );
}
