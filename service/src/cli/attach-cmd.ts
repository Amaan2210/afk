import type { Command } from "commander";
import type { Session } from "../protocol/index.js";
import { attach, exitCodeFor, requireTty, type AttachClient, type AttachIo } from "./attach.js";
import { CliError, parsePortOption, withDaemon, type ClientOptions } from "./run.js";
import { SessionWatch } from "./session-watch.js";

/**
 * The session `target` names: the one with that exact id, else the one with that exact name.
 * Refuses no match, a name several sessions share (listing them), and a session that has ended.
 */
export function resolveSession(target: string, sessions: Session[]): Session {
  const byId = sessions.find((s) => s.id === target);
  const matches = byId !== undefined ? [byId] : sessions.filter((s) => s.name === target);
  if (matches.length === 0) {
    throw new CliError(`There is no session "${target}". \`afk ls\` lists them.`);
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

export function registerAttachCommand(program: Command): void {
  program
    .command("attach")
    .description("attach this window to a running session (detach: Ctrl+] then d)")
    .argument("<session>", "the session's id or name, as shown by `afk ls`")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption)
    .action(async (target: string, opts: ClientOptions) => {
      let code: number | undefined;
      await withDaemon(opts, async ({ client }) => {
        code = await runAttach(target, client, { stdin: process.stdin, stdout: process.stdout });
      });
      if (code !== undefined) process.exitCode = code;
    });
}
