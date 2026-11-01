#!/usr/bin/env node
import { Command } from "commander";
import { registerDaemonCommand } from "./cli/daemon-cmd.js";
import { registerDevicesCommands } from "./cli/devices.js";
import { registerKillCommand } from "./cli/kill.js";
import { registerLsCommand } from "./cli/ls.js";
import { registerPairCommand } from "./cli/pair.js";
import { registerRelayCommands } from "./cli/relay-cmd.js";
import { VERSION } from "./version.js";

const program = new Command("afk")
  .description("Remote control for Claude Code and Codex sessions on this machine")
  .version(VERSION)
  .enablePositionalOptions();

registerDaemonCommand(program);
registerLsCommand(program);
registerKillCommand(program);
registerPairCommand(program);
registerDevicesCommands(program);
registerRelayCommands(program);

try {
  await program.parseAsync();
} catch (err) {
  process.stderr.write(`afk: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
