import type { Command } from "commander";
import { parsePortOption, withDaemon, type ClientOptions, type CommandIo } from "./run.js";

/** Ends a session; the daemon answers an unknown id with a `not_found` error. */
export async function runKill(sessionId: string, { stdout, client }: CommandIo): Promise<void> {
  await client.request({ type: "session.kill", sessionId });
  stdout.write(`Killed ${sessionId}.\n`);
}

export function registerKillCommand(program: Command): void {
  program
    .command("kill")
    .description("end a session")
    .argument("<sessionId>", "the session id, as shown by `afk ls`")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption)
    .action((sessionId: string, opts: ClientOptions) =>
      withDaemon(opts, (io) => runKill(sessionId, io)),
    );
}
