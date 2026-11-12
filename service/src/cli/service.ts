import { isDaemonUp, startInBackground } from "./autostart.js";
import type { DaemonClient } from "./client.js";
import { localDeps, withDaemon, type ClientOptions, type CommandIo, type RunDeps } from "./run.js";
import { afkPaths, defaultConfigDir } from "../daemon/paths.js";
import { alreadyStopped, confirmOnTty, runUnpair, type UnpairOptions } from "./unpair.js";

export type ServiceAction = "start" | "stop" | "status";

export type ServiceOptions = ClientOptions & UnpairOptions;

/** What `runService` uses besides `RunDeps`; each has a default for the real machine. */
export interface ServiceIo {
  /** Whether a daemon answers on the port (default: a 1 s probe of 127.0.0.1). */
  isUp?: (port: number) => Promise<boolean>;
  /** Asks a yes/no question; undefined when input is not interactive. */
  confirm?: (question: string) => Promise<boolean | undefined>;
}

function plural(n: number, one: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${one}s`;
}

/** `Running`, with what it is serving. */
async function status({ stdout, client, port }: CommandIo<DaemonClient>): Promise<number> {
  const [sessions, { devices }] = await Promise.all([
    client.sessions(),
    client.request<{ devices: { name: string }[] }>({ type: "device.list" }),
  ]);
  const running = sessions.filter((s) => s.state !== "ended").length;
  const phone = devices[0] === undefined ? "no phone paired" : `paired with "${devices[0].name}"`;
  stdout.write(`Running on port ${port}: ${plural(running, "running session")}, ${phone}.\n`);
  return 0;
}

/** Starts the daemon unless one already answers. */
async function start(opts: ServiceOptions, deps: RunDeps, io: ServiceIo): Promise<void> {
  try {
    const port = opts.port ?? (await deps.loadPort(deps.paths).catch(() => undefined));
    if (port !== undefined && (await (io.isUp ?? isDaemonUp)(port))) {
      deps.stdout.write("AFK is already running.\n");
      return;
    }
    await (deps.start ?? startInBackground)(deps.paths, opts.port);
    deps.stdout.write(
      "Started AFK in the background. It stops by itself once it has had something to do and " +
        "nothing is left; `afk unpair` stops it now.\n",
    );
  } catch (err) {
    deps.stderr.write(`afk: ${err instanceof Error ? err.message : String(err)}\n`);
    deps.setExitCode(1);
  }
}

/**
 * `afk service start|stop|status`. AFK's daemon runs in the background, never from logon: it
 * starts with the first session or with `afk pair`, and `start` only does the same by hand.
 * `stop` is `afk unpair`. `status` prints `Running …` (exit 0) or `Not running` (exit 1).
 */
export async function runService(
  action: ServiceAction,
  opts: ServiceOptions = {},
  deps: RunDeps = localDeps(afkPaths(defaultConfigDir())),
  io: ServiceIo = {},
): Promise<void> {
  switch (action) {
    case "start":
      return start(opts, deps, io);
    case "stop":
      return withDaemon(
        opts,
        (c) => runUnpair(opts, { ...c, confirm: io.confirm ?? confirmOnTty }),
        deps,
        undefined,
        { whenDown: alreadyStopped },
      );
    case "status":
      return withDaemon(opts, status, deps, undefined, {
        whenDown: (stdout) => {
          stdout.write("Not running\n");
          return 1;
        },
      });
  }
}
