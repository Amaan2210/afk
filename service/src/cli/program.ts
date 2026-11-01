import { Command, Option } from "commander";
import { VERSION } from "../version.js";
import type { DaemonClient } from "./client.js";
import type { DaemonCommandOptions } from "./daemon-cmd.js";
import type { LaunchOptions, LaunchRunner } from "./launch.js";
import { parsePort, parsePortOption } from "./options.js";
import type { ClientOptions, CommandIo } from "./run.js";
import type { ServiceAction } from "./service.js";

// Only commander's wiring lives here. Each action imports its implementation when it runs, so
// `afk hook` (run by every agent hook) and `afk --version` load neither the daemon nor the client.

const PORT_HELP = "the daemon port (default: the configured one)";

/** Runs `command` on a connection to the daemon; both are loaded only when the action runs. */
async function withDaemonLoaded<M>(
  opts: ClientOptions,
  load: () => Promise<M>,
  command: (module: M, io: CommandIo<DaemonClient>) => Promise<number | void>,
): Promise<void> {
  const [{ withDaemon }, module] = await Promise.all([import("./run.js"), load()]);
  await withDaemon(opts, (io) => command(module, io));
}

const runLaunchLazily: LaunchRunner = async (kind, args, opts) =>
  (await import("./launch.js")).runLaunch(kind, args, opts);

function launcher(program: Command, name: string, description: string): Command {
  return program
    .command(name)
    .description(description)
    .option("--name <name>", "the session's name (default: the folder's name)")
    .option("--port <n>", PORT_HELP, parsePortOption);
}

/**
 * `afk claude` and `afk codex` pass every argument after their own options to the agent
 * untouched; `--name` and `--port` count only before the first agent argument. `afk shell` runs
 * no agent and takes no arguments.
 */
export function registerLaunchCommands(program: Command, run = runLaunchLazily): void {
  for (const agent of ["claude", "codex"] as const) {
    launcher(program, agent, `start ${agent} in a new session in this folder and attach to it`)
      .argument(
        "[args...]",
        `${agent}'s own arguments, passed untouched; afk's options go first, and -- passes -h on`,
      )
      .allowUnknownOption()
      .passThroughOptions()
      .action((args: string[], opts: LaunchOptions) => run(agent, args, opts));
  }
  launcher(program, "shell", "start a shell session in this folder and attach to it").action(
    (opts: LaunchOptions) => run("shell", [], opts),
  );
}

const SERVICE_ACTIONS: [ServiceAction, string][] = [
  ["install", "create the scheduled task that runs the daemon from logon, and start it"],
  ["uninstall", "stop the daemon and remove the scheduled task; this ends every session"],
  ["start", "start the daemon from the scheduled task"],
  ["stop", "stop the daemon the scheduled task runs; this ends every session"],
  ["status", "print whether the scheduled task's daemon is running"],
];

function registerDaemonCommand(program: Command): void {
  program
    .command("daemon")
    .description("run the AFK daemon in the foreground; stopping it ends every session")
    .option("--verbose", "log at debug level, to stdout as well as to the log file")
    .option("--port <n>", "listen on this port instead of the configured one", parsePort)
    // For the scheduled task (afk service), whose PowerShell is the parent.
    .addOption(new Option("--exit-with-parent", "stop when the parent process exits").hideHelp())
    .action(async (opts: DaemonCommandOptions) =>
      (await import("./daemon-cmd.js")).runDaemon(opts),
    );
}

function registerServiceCommands(program: Command): void {
  const service = program
    .command("service")
    .description("run the daemon in the background from logon (a Windows scheduled task)");
  for (const [action, description] of SERVICE_ACTIONS) {
    const command = service.command(action).description(description);
    if (action !== "status") {
      command.option(
        "--port <n>",
        "the port to check for a running daemon (default: the configured one)",
        parsePortOption,
      );
    }
    command.action(async (opts: { port?: number }) => {
      const { execProgram, runService } = await import("./service.js");
      const io = { exec: execProgram, stdout: process.stdout, port: opts.port };
      process.exitCode = await runService(action, io);
    });
  }
}

function registerClientCommands(program: Command): void {
  program
    .command("attach")
    .description("attach this window to a running session (detach: Ctrl+] then d)")
    .argument("<session>", "the session's id or name, as shown by `afk ls`")
    .option("--port <n>", PORT_HELP, parsePortOption)
    .action(async (target: string, opts: ClientOptions) =>
      (await import("./attach-cmd.js")).runAttachCommand(target, opts),
    );
  program
    .command("ls")
    .description("list the sessions the daemon owns")
    .option("--port <n>", PORT_HELP, parsePortOption)
    .action((opts: ClientOptions) =>
      withDaemonLoaded(
        opts,
        () => import("./ls.js"),
        (m, io) => m.runLs(io),
      ),
    );
  program
    .command("kill")
    .description("end a session")
    .argument("<sessionId>", "the session id, as shown by `afk ls`")
    .option("--port <n>", PORT_HELP, parsePortOption)
    .action((sessionId: string, opts: ClientOptions) =>
      withDaemonLoaded(
        opts,
        () => import("./kill.js"),
        (m, io) => m.runKill(sessionId, io),
      ),
    );
  program
    .command("pair")
    .description("pair a phone: shows a QR code for the AFK app to scan")
    .option("--name <name>", "the phone name (asked for if omitted)")
    .option("--port <n>", PORT_HELP, parsePortOption)
    .action((opts: ClientOptions & { name?: string }) =>
      withDaemonLoaded(
        opts,
        () => import("./pair.js"),
        (m, io) => m.runPair(opts, { ...io, promptName: m.promptNameOnTty }),
      ),
    );
  program
    .command("devices")
    .description("list the paired phones")
    .option("--port <n>", PORT_HELP, parsePortOption)
    .action((opts: ClientOptions) =>
      withDaemonLoaded(
        opts,
        () => import("./devices.js"),
        (m, io) => m.runDevices(io),
      ),
    );
  program
    .command("unpair")
    .description("revoke a paired phone")
    .argument("<deviceId>", "the device id, as shown by `afk devices`")
    .option("--port <n>", PORT_HELP, parsePortOption)
    .action((deviceId: string, opts: ClientOptions) =>
      withDaemonLoaded(
        opts,
        () => import("./devices.js"),
        (m, io) => m.runUnpair(deviceId, io),
      ),
    );
}

/** Hidden commands the session shell and the agents call; not part of the user-facing CLI. */
function registerRelayCommands(program: Command): void {
  program
    .command("exec", { hidden: true })
    .argument("<agent>", "claude or codex")
    .argument("[args...]")
    .passThroughOptions()
    .allowUnknownOption()
    .helpOption(false)
    .action(async (agent: string, args: string[]) => {
      if (agent !== "claude" && agent !== "codex") {
        process.stderr.write(`afk exec: unknown agent "${agent}"\n`);
        process.exitCode = 1;
        return;
      }
      const [{ runExec }, { postLoopback }] = await Promise.all([
        import("./exec.js"),
        import("./post.js"),
      ]);
      process.exitCode = await runExec(agent, args, { env: process.env, post: postLoopback });
    });

  program
    .command("hook", { hidden: true })
    .argument("<event>")
    .argument("[args...]")
    .passThroughOptions()
    .allowUnknownOption()
    .helpOption(false)
    .action(async (event: string, args: string[]) => {
      const [{ runHook }, { postLoopback }] = await Promise.all([
        import("./hook.js"),
        import("./post.js"),
      ]);
      await runHook(event, { stdin: process.stdin, env: process.env, post: postLoopback, args });
      process.exit(0);
    });

  program
    .command("statusline", { hidden: true })
    .helpOption(false)
    .action(async () => {
      const [{ runStatusline }, { postLoopback }] = await Promise.all([
        import("./statusline.js"),
        import("./post.js"),
      ]);
      process.exitCode = await runStatusline({
        stdin: process.stdin,
        stdout: process.stdout,
        env: process.env,
        post: postLoopback,
      });
    });
}

/** The whole `afk` command line. */
export function buildProgram(): Command {
  const program = new Command("afk")
    .description("Remote control for Claude Code and Codex sessions on this machine")
    .version(VERSION)
    .enablePositionalOptions();
  registerDaemonCommand(program);
  registerLaunchCommands(program);
  registerClientCommands(program);
  registerServiceCommands(program);
  registerRelayCommands(program);
  return program;
}
