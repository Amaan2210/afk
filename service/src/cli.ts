#!/usr/bin/env node
import { Command } from "commander";
import { registerDaemonCommand } from "./cli/daemon-cmd.js";
import { VERSION } from "./version.js";

const program = new Command("afk")
  .description("Remote control for Claude Code and Codex sessions on this machine")
  .version(VERSION);

registerDaemonCommand(program);

try {
  await program.parseAsync();
} catch (err) {
  process.stderr.write(`afk: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
