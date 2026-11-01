import { InvalidArgumentError, type Command } from "commander";
import { startDaemon, type Daemon } from "../daemon/index.js";
import { VERSION } from "../version.js";

interface DaemonCommandOptions {
  verbose?: boolean;
  port?: number;
}

/** Ctrl+C, a service stop, and closing the console window (SIGHUP on Windows). */
const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

function parsePort(value: string): number {
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
 * Process-wide handling for the daemon's lifetime: a stray exception in some event handler is
 * logged and the daemon keeps serving, rather than every session ending with it; a stop signal
 * stops the daemon, then exits.
 */
function handleProcessEvents(daemon: Daemon): void {
  const { log } = daemon;
  process.on("uncaughtException", (err) => log.error({ err }, "uncaught exception"));
  process.on("unhandledRejection", (reason) => log.error({ err: reason }, "unhandled rejection"));
  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "daemon stopping");
    daemon.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  for (const signal of STOP_SIGNALS) process.on(signal, stop);
}

async function runDaemon(opts: DaemonCommandOptions): Promise<void> {
  const daemon = await startDaemon({ port: opts.port, verbose: opts.verbose ?? false });
  handleProcessEvents(daemon);
  const where = daemon.addresses.map((a) => hostPort(a, daemon.port)).join(", ");
  process.stdout.write(`afk daemon ${VERSION} listening on ${where}\n`);
  if (daemon.warning !== undefined) process.stdout.write(`warning: ${daemon.warning}\n`);
}

export function registerDaemonCommand(program: Command): void {
  program
    .command("daemon")
    .description("run the AFK daemon in the foreground; stopping it ends every session")
    .option("--verbose", "log at debug level, to stdout as well as to the log file")
    .option("--port <n>", "listen on this port instead of the configured one", parsePort)
    .action((opts: DaemonCommandOptions) => runDaemon(opts));
}
