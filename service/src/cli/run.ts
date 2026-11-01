import { InvalidArgumentError } from "commander";
import { loadConfig } from "../daemon/config.js";
import { afkPaths, defaultConfigDir } from "../daemon/paths.js";
import { DaemonClient, DaemonNotRunningError, type CommandClient } from "./client.js";

/** A failure to report on stderr and exit with `code`. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: number = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface Output {
  write(text: string): unknown;
}

/** What a command gets: where to print, a client for the daemon, and the port it is on. */
export interface CommandIo {
  stdout: Output;
  client: CommandClient;
  port: number;
}

export interface ClientOptions {
  port?: number;
}

export const EXIT_NOT_RUNNING = 2;
export const NOT_RUNNING_HINT =
  "Run `afk service install` to keep it running in the background, or `afk daemon` to run it in this window.";

export function parsePortOption(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new InvalidArgumentError("Expected a port number from 1 to 65535.");
  }
  return port;
}

/**
 * Connects to the local daemon, runs `command`, and closes the connection. Sets the exit code:
 * 0 on success, 2 when no daemon is running, 1 for anything else.
 */
export async function withDaemon(
  opts: ClientOptions,
  command: (io: CommandIo) => Promise<void>,
): Promise<void> {
  const paths = afkPaths(defaultConfigDir());
  let client: DaemonClient | undefined = undefined;
  try {
    const port = opts.port ?? (await loadConfig(paths)).port;
    client = await DaemonClient.connectLocal(paths, port);
    await command({ stdout: process.stdout, client, port });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof DaemonNotRunningError) {
      process.stderr.write(`afk: ${message}\n${NOT_RUNNING_HINT}\n`);
      process.exitCode = EXIT_NOT_RUNNING;
    } else {
      process.stderr.write(`afk: ${message}\n`);
      process.exitCode = err instanceof CliError ? err.code : 1;
    }
  } finally {
    client?.close();
  }
}
