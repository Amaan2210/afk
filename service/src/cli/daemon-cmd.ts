import { InvalidArgumentError, type Command } from "commander";
import { startDaemon, type Daemon, type DaemonOptions } from "../daemon/index.js";
import { VERSION } from "../version.js";

interface DaemonCommandOptions {
  verbose?: boolean;
  port?: number;
}

/** The parts of `process` the command uses. */
export interface DaemonProcess {
  on(event: string, listener: (arg: unknown) => void): unknown;
  exit(code: number): void;
}

export interface DaemonCommandDeps {
  start: (opts: DaemonOptions) => Promise<Daemon>;
  proc: DaemonProcess;
  print: (line: string) => void;
}

const defaultDeps: DaemonCommandDeps = {
  start: startDaemon,
  proc: process,
  print: (line) => void process.stdout.write(`${line}\n`),
};

/** Ctrl+C, Ctrl+Break, a service stop, and closing the console window (SIGHUP on Windows). */
const STOP_SIGNALS = ["SIGINT", "SIGBREAK", "SIGTERM", "SIGHUP"];

export function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65_535) {
    throw new InvalidArgumentError("Expected a port number from 0 to 65535.");
  }
  return port;
}

function hostPort(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

/**
 * Runs the daemon until a stop signal. Signals are handled from the start: one that arrives while
 * the daemon starts stops it once it has started, so its lock is released; another one while it
 * stops exits at once. Once running, a stray exception in some event handler is logged and the
 * daemon keeps serving, rather than every session ending with it.
 */
export async function runDaemon(
  opts: DaemonCommandOptions,
  deps: DaemonCommandDeps = defaultDeps,
): Promise<void> {
  const { proc } = deps;
  // Set once started; the signal handler reads it before then.
  let daemon: Daemon | undefined = undefined;
  let stopRequested = false;
  const stop = (d: Daemon): void => {
    d.stop().then(
      () => proc.exit(0),
      () => proc.exit(1),
    );
  };
  const onSignal = (signal: string): void => {
    if (stopRequested) return proc.exit(1);
    stopRequested = true;
    if (daemon === undefined) return;
    daemon.log.info({ signal }, "daemon stopping");
    stop(daemon);
  };
  for (const signal of STOP_SIGNALS) proc.on(signal, () => onSignal(signal));

  daemon = await deps.start({ port: opts.port, verbose: opts.verbose ?? false });
  const { log } = daemon;
  if (stopRequested) {
    log.info("daemon stopping: asked to while it started");
    return stop(daemon);
  }
  proc.on("uncaughtException", (err) => log.error({ err }, "uncaught exception"));
  proc.on("unhandledRejection", (reason) => log.error({ err: reason }, "unhandled rejection"));
  const where = daemon.addresses.map((a) => hostPort(a, daemon.port)).join(", ");
  deps.print(`afk daemon ${VERSION} listening on ${where}`);
  if (daemon.warning !== undefined) deps.print(`warning: ${daemon.warning}`);
}

export function registerDaemonCommand(program: Command): void {
  program
    .command("daemon")
    .description("run the AFK daemon in the foreground; stopping it ends every session")
    .option("--verbose", "log at debug level, to stdout as well as to the log file")
    .option("--port <n>", "listen on this port instead of the configured one", parsePort)
    .action((opts: DaemonCommandOptions) => runDaemon(opts));
}
