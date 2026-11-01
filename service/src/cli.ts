#!/usr/bin/env node
import { buildProgram } from "./cli/program.js";

try {
  await buildProgram().parseAsync();
} catch (err) {
  process.stderr.write(`afk: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
