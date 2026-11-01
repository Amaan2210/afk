import { formatSessionTable } from "./format.js";
import type { CommandIo } from "./run.js";

/** Prints the sessions the daemon owns as a table. */
export async function runLs({ stdout, client }: CommandIo): Promise<void> {
  stdout.write(`${formatSessionTable(await client.sessions())}\n`);
}
