import { resolveSession } from "./attach-cmd.js";
import { CliError, type CommandIo } from "./run.js";

/**
 * Ends the session `target` names (its id or name). With no target it ends the session this
 * command was typed in, which the session's shell names in `AFK_SESSION_ID`.
 */
export async function runKill(
  target: string | undefined,
  { stdout, client }: CommandIo,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const wanted = target ?? env.AFK_SESSION_ID;
  if (wanted === undefined || wanted === "") {
    throw new CliError(
      "Name the session to end: `afk kill <id or name>` (`afk ls` lists them). " +
        "Inside a session, `afk kill` alone ends that session.",
    );
  }
  const session = resolveSession(wanted, await client.sessions(), "kill");
  await client.request({ type: "session.kill", sessionId: session.id });
  stdout.write(`Ended ${session.name || session.id}.\n`);
}
