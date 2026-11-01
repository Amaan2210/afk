import type { Command } from "commander";
import { formatSessionTable } from "./format.js";
import { parsePortOption, withDaemon, type ClientOptions, type CommandIo } from "./run.js";

/** Prints the sessions the daemon owns as a table. */
export async function runLs({ stdout, client }: CommandIo): Promise<void> {
  stdout.write(`${formatSessionTable(await client.sessions())}\n`);
}

export function registerLsCommand(program: Command): void {
  program
    .command("ls")
    .description("list the sessions the daemon owns")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption)
    .action((opts: ClientOptions) => withDaemon(opts, runLs));
}
