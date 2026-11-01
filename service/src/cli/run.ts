import { readConfig } from "../daemon/config.js";
import { afkPaths, defaultConfigDir, type AfkPaths } from "../daemon/paths.js";
import {
  DaemonClient,
  DaemonNotRunningError,
  DaemonNotSetUpError,
  type CommandClient,
} from "./client.js";

export { NOT_SET_UP } from "./client.js";
export { parsePortOption } from "./options.js";

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

export interface RunDeps {
  paths: AfkPaths;
  loadPort: (paths: AfkPaths) => Promise<number>;
  connect: (paths: AfkPaths, port: number) => Promise<DaemonClient>;
  stdout: Output;
  stderr: Output;
  setExitCode: (code: number) => void;
}

/**
 * Reads the config dir `paths` names without changing it: a client command never creates a config
 * or mints a token, which is the daemon's job.
 */
export function localDeps(paths: AfkPaths): RunDeps {
  return {
    paths,
    loadPort: async (p) => {
      const config = await readConfig(p);
      if (config === undefined) throw new DaemonNotSetUpError();
      return config.port;
    },
    connect: (p, port) => DaemonClient.connectLocal(p, port),
    stdout: process.stdout,
    stderr: process.stderr,
    setExitCode: (code) => void (process.exitCode = code),
  };
}

function defaultDeps(): RunDeps {
  return localDeps(afkPaths(defaultConfigDir()));
}

/**
 * Connects to the local daemon, runs `command`, and closes the connection. Sets the exit code:
 * the one `command` returns, if any (else 0 on success), 2 when no daemon is running or none was
 * ever set up (no config or local token; nothing is created), 1 for anything else. `precheck`
 * runs first, before the config is read: a command that cannot run here fails the same way
 * whether or not a daemon is running.
 */
export async function withDaemon(
  opts: ClientOptions,
  command: (io: CommandIo<DaemonClient>) => Promise<number | void>,
  deps: RunDeps = defaultDeps(),
  precheck: () => void = () => undefined,
): Promise<void> {
  let client: DaemonClient | undefined = undefined;
  try {
    precheck();
    const port = opts.port ?? (await deps.loadPort(deps.paths));
    client = await deps.connect(deps.paths, port);
    const code = await command({ stdout: deps.stdout, client, port });
    if (typeof code === "number") deps.setExitCode(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof DaemonNotRunningError) {
      deps.stderr.write(`afk: ${message}\n${NOT_RUNNING_HINT}\n`);
      deps.setExitCode(EXIT_NOT_RUNNING);
    } else if (err instanceof DaemonNotSetUpError) {
      deps.stderr.write(`afk: ${message}\n`);
      deps.setExitCode(EXIT_NOT_RUNNING);
    } else {
      deps.stderr.write(`afk: ${message}\n`);
      deps.setExitCode(err instanceof CliError ? err.code : 1);
    }
  } finally {
    client?.close();
  }
}
