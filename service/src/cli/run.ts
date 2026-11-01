import { InvalidArgumentError } from "commander";
import { loadConfig } from "../daemon/config.js";
import { afkPaths, defaultConfigDir, type AfkPaths } from "../daemon/paths.js";
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
export interface CommandIo<C = CommandClient> {
  stdout: Output;
  client: C;
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

export interface RunDeps {
  paths: AfkPaths;
  loadPort: (paths: AfkPaths) => Promise<number>;
  connect: (paths: AfkPaths, port: number) => Promise<DaemonClient>;
  stdout: Output;
  stderr: Output;
  setExitCode: (code: number) => void;
}

function defaultDeps(): RunDeps {
  return {
    paths: afkPaths(defaultConfigDir()),
    loadPort: async (paths) => (await loadConfig(paths)).port,
    connect: (paths, port) => DaemonClient.connectLocal(paths, port),
    stdout: process.stdout,
    stderr: process.stderr,
    setExitCode: (code) => void (process.exitCode = code),
  };
}

/**
 * Connects to the local daemon, runs `command`, and closes the connection. Sets the exit code:
 * the one `command` returns, if any (else 0 on success), 2 when no daemon is running, 1 for
 * anything else.
 */
export async function withDaemon(
  opts: ClientOptions,
  command: (io: CommandIo<DaemonClient>) => Promise<number | void>,
  deps: RunDeps = defaultDeps(),
): Promise<void> {
  let client: DaemonClient | undefined = undefined;
  try {
    const port = opts.port ?? (await deps.loadPort(deps.paths));
    client = await deps.connect(deps.paths, port);
    const code = await command({ stdout: deps.stdout, client, port });
    if (typeof code === "number") deps.setExitCode(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof DaemonNotRunningError) {
      deps.stderr.write(`afk: ${message}\n${NOT_RUNNING_HINT}\n`);
      deps.setExitCode(EXIT_NOT_RUNNING);
    } else {
      deps.stderr.write(`afk: ${message}\n`);
      deps.setExitCode(err instanceof CliError ? err.code : 1);
    }
  } finally {
    client?.close();
  }
}
