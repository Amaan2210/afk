import { startDaemon, type Daemon, type DaemonOptions } from "../daemon/index.js";
import { VERSION } from "../version.js";

export { parsePort } from "./options.js";

export interface DaemonCommandOptions {
  verbose?: boolean;
  port?: number;
  /** Stop once the parent process has exited (the scheduled task's PowerShell). */
  exitWithParent?: boolean;
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
  /** Whether the parent process still runs (default: a signal-0 check of the parent's pid). */
  parentAlive?: () => boolean;
  /** How often `--exit-with-parent` checks (default 1 s). */
  parentPollMs?: number;
}

/** Read once: the parent's pid is what to watch, even after the parent is gone. */
const PARENT_PID = process.ppid;
const PARENT_POLL_MS = 1000;

/** Signal 0 checks that a process exists; EPERM means it does, under another account. */
function parentAlive(): boolean {
  try {
    process.kill(PARENT_PID, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

const defaultDeps: DaemonCommandDeps = {
  start: startDaemon,
  proc: process,
  print: (line) => void process.stdout.write(`${line}\n`),
};

/** Ctrl+C, Ctrl+Break, a service stop, and closing the console window (SIGHUP on Windows). */
const STOP_SIGNALS = ["SIGINT", "SIGBREAK", "SIGTERM", "SIGHUP"];

function hostPort(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

/**
 * Runs the daemon until a stop signal or, with `exitWithParent`, until the parent process exits
 * (ending the scheduled task ends its PowerShell, not the daemon it started). Either is handled
 * from the start: one that arrives while the daemon starts ends a wait for Tailscale at once, or
 * else stops the daemon once it has started, so its lock is released, then exits 0; another
 * signal while it stops exits 1 at once. Once running, a stray exception in some event handler is
 * logged and the daemon keeps serving, rather than every session ending with it.
 */
export async function runDaemon(
  opts: DaemonCommandOptions,
  deps: DaemonCommandDeps = defaultDeps,
): Promise<void> {
  const { proc } = deps;
  // Set once started; the signal handler reads it before then.
  let daemon: Daemon | undefined = undefined;
  let stopRequested = false;
  let parentWatch: NodeJS.Timeout | undefined;
  const starting = new AbortController();
  const stop = (d: Daemon): void => {
    clearInterval(parentWatch);
    d.stop().then(
      () => proc.exit(0),
      () => proc.exit(1),
    );
  };
  const requestStop = (why: { signal: string } | { reason: string }): void => {
    if (stopRequested) return proc.exit(1);
    stopRequested = true;
    if (daemon === undefined) return starting.abort();
    daemon.log.info(why, "daemon stopping");
    stop(daemon);
  };
  for (const signal of STOP_SIGNALS) proc.on(signal, () => requestStop({ signal }));
  if (opts.exitWithParent === true) {
    const alive = deps.parentAlive ?? parentAlive;
    parentWatch = setInterval(() => {
      // A stop already asked for runs its course; a second request would exit 1 mid-way.
      if (stopRequested) return clearInterval(parentWatch);
      if (alive()) return;
      clearInterval(parentWatch);
      requestStop({ reason: "parent exited" });
    }, deps.parentPollMs ?? PARENT_POLL_MS);
    // The servers keep a running daemon alive; this must not keep a failed start alive.
    parentWatch.unref();
  }

  try {
    daemon = await deps.start({
      port: opts.port,
      verbose: opts.verbose ?? false,
      print: deps.print,
      signal: starting.signal,
    });
  } catch (err) {
    clearInterval(parentWatch);
    // Asked to stop while it started: whatever the start did not finish, the stop is done.
    if (stopRequested) return proc.exit(0);
    throw err;
  }
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
