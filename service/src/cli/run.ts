import { readConfig } from "../daemon/config.js";
import { afkPaths, defaultConfigDir, type AfkPaths } from "../daemon/paths.js";
import { startInBackground } from "./autostart.js";
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
  "It starts with your first session (`afk claude`, `afk codex` or `afk shell`) or with `afk pair`.";

export interface RunDeps {
  paths: AfkPaths;
  loadPort: (paths: AfkPaths) => Promise<number>;
  connect: (paths: AfkPaths, port: number) => Promise<DaemonClient>;
  /** Starts the daemon in the background and waits until it answers (default: the real one). */
  start?: (paths: AfkPaths, port?: number) => Promise<unknown>;
  stdout: Output;
  stderr: Output;
  setExitCode: (code: number) => void;
}

/** How a command treats a daemon that is not running. */
export interface DaemonNeed {
  /** Start it in the background first. For the commands that give it something to do. */
  autostart?: boolean;
  /** Runs instead of the command, in place of the "not running" error; returns the exit code. */
  whenDown?: (stdout: Output) => number;
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

function isDown(err: unknown): boolean {
  return err instanceof DaemonNotRunningError || err instanceof DaemonNotSetUpError;
}

/** A connection to the daemon and its port; with `autostart`, a daemon that is down is started. */
async function open(
  opts: ClientOptions,
  deps: RunDeps,
  autostart: boolean,
): Promise<{ client: DaemonClient; port: number }> {
  const connect = async () => {
    const port = opts.port ?? (await deps.loadPort(deps.paths));
    return { client: await deps.connect(deps.paths, port), port };
  };
  try {
    return await connect();
  } catch (err) {
    if (!autostart || !isDown(err)) throw err;
  }
  deps.stderr.write("Starting AFK in the background…\n");
  await (deps.start ?? startInBackground)(deps.paths, opts.port);
  return connect();
}

/**
 * Connects to the local daemon, runs `command`, and closes the connection. A daemon that is not
 * running is started first when `need.autostart` is set; otherwise `need.whenDown` runs in the
 * command's place, if given. Sets the exit code: the one `command` returns, if any (else 0 on
 * success), 2 when no daemon is running or none was ever set up (nothing is created), 1 for
 * anything else. `precheck` runs first, before the config is read: a command that cannot run here
 * fails the same way whether or not a daemon is running.
 */
export async function withDaemon(
  opts: ClientOptions,
  command: (io: CommandIo<DaemonClient>) => Promise<number | void>,
  deps: RunDeps = defaultDeps(),
  precheck: () => void = () => undefined,
  need: DaemonNeed = {},
): Promise<void> {
  let client: DaemonClient | undefined = undefined;
  try {
    precheck();
    const opened = await open(opts, deps, need.autostart === true);
    client = opened.client;
    const code = await command({ stdout: deps.stdout, client, port: opened.port });
    if (typeof code === "number") deps.setExitCode(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isDown(err) && need.whenDown !== undefined) {
      deps.setExitCode(need.whenDown(deps.stdout));
    } else if (err instanceof DaemonNotRunningError) {
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
