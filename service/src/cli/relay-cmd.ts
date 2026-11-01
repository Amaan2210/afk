import type { Command } from "commander";
import { runExec } from "./exec.js";
import { runHook } from "./hook.js";
import { postLoopback } from "./post.js";
import { runStatusline } from "./statusline.js";

/** Hidden commands the session shell and the agents call; not part of the user-facing CLI. */
export function registerRelayCommands(program: Command): void {
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
      await runHook(event, { stdin: process.stdin, env: process.env, post: postLoopback, args });
      process.exit(0);
    });

  program
    .command("statusline", { hidden: true })
    .helpOption(false)
    .action(async () => {
      process.exitCode = await runStatusline({
        stdin: process.stdin,
        stdout: process.stdout,
        env: process.env,
        post: postLoopback,
      });
    });
}
