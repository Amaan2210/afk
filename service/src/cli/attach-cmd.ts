import type { Command } from "commander";
import type { Session } from "../protocol/index.js";
import { attach, exitCodeFor, requireTty, type AttachClient, type AttachIo } from "./attach.js";
import { CliError, parsePortOption, withDaemon, type ClientOptions, type RunDeps } from "./run.js";
import { SessionWatch } from "./session-watch.js";

/**
 * The session `target` names: the one with that exact id, else the running one with that exact
 * name (the daemon keeps those unique; ended sessions keep theirs). Refuses no match, a name
 * several sessions share (listing them), and a session that has ended.
 */
export function resolveSession(target: string, sessions: Session[]): Session {
  const byId = sessions.find((s) => s.id === target);
  const named = sessions.filter((s) => s.name === target);
  const matches = byId !== undefined ? [byId] : named.filter((s) => s.state !== "ended");
  if (matches.length === 0) {
    const what =
      named.length > 0
        ? `running session "${target}"; one by that name has ended`
        : `session "${target}"`;
    throw new CliError(`There is no ${what}. \`afk ls\` lists them.`);
  }
  if (matches.length > 1) {
    const idWidth = Math.max(...matches.map((s) => s.id.length));
    const nameWidth = Math.max(...matches.map((s) => s.name.length));
    const rows = matches.map(
      (s) => `  ${s.id.padEnd(idWidth)}  ${s.name.padEnd(nameWidth)}  ${s.state}`,
    );
    const header = `"${target}" names ${matches.length} sessions; use \`afk attach <id>\`:`;
    throw new CliError([header, ...rows].join("\n"));
  }
  const session = matches[0] as Session;
  if (session.state === "ended") {
    const name = session.name || session.id;
    const code = session.exitCode === undefined ? "" : ` (exit ${session.exitCode})`;
    throw new CliError(`The session ${name} has ended${code}; there is nothing to attach to.`);
  }
  return session;
}

/** Attaches this terminal to the session `target` names; resolves with the exit code. */
export async function runAttach(
  target: string,
  client: AttachClient,
  io: AttachIo,
): Promise<number> {
  requireTty(io.stdin);
  // Watching from before the list is read: no update between the two is missed.
  const watch = new SessionWatch(client);
  try {
    watch.seed(await client.sessions());
    const { id } = resolveSession(target, watch.list());
    const outcome = await attach(client, id, io, watch);
    return exitCodeFor(outcome, watch.get(id));
  } finally {
    watch.stop();
  }
}

/** `afk attach <session>`; refuses without a terminal before connecting. */
export function runAttachCommand(
  target: string,
  opts: ClientOptions,
  io: AttachIo = { stdin: process.stdin, stdout: process.stdout },
  deps?: RunDeps,
): Promise<void> {
  const command = ({ client }: { client: AttachClient }) => runAttach(target, client, io);
  return withDaemon(opts, command, deps, () => requireTty(io.stdin));
}

export function registerAttachCommand(program: Command): void {
  program
    .command("attach")
    .description("attach this window to a running session (detach: Ctrl+] then d)")
    .argument("<session>", "the session's id or name, as shown by `afk ls`")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption)
    .action((target: string, opts: ClientOptions) => runAttachCommand(target, opts));
}
