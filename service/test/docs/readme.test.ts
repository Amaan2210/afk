import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/program.js";

const readme = readFileSync("../README.md", "utf8");

describe("README", () => {
  it("documents every afk command", () => {
    for (const c of [
      "afk claude",
      "afk codex",
      "afk shell",
      "afk attach",
      "afk ls",
      "afk kill",
      "afk pair",
      "afk devices",
      "afk unpair",
      "afk service install",
    ]) {
      expect(readme).toContain(c);
    }
  });

  it("documents every visible subcommand of the afk program", () => {
    // The program src/cli.ts runs, so a new command cannot be left out.
    const program = buildProgram();

    // The implicit `help` command is commander's, not ours.
    const help = program.createHelp();
    const visible = (c: Command) => help.visibleCommands(c).filter((s) => s.name() !== "help");
    const names: string[] = [];
    for (const cmd of visible(program)) {
      const subs = visible(cmd);
      if (subs.length === 0) names.push(cmd.name());
      else names.push(...subs.map((s) => `${cmd.name()} ${s.name()}`));
    }
    expect(names).toEqual(expect.arrayContaining(["claude", "attach", "service install"]));
    for (const name of names) expect(readme, `afk ${name}`).toContain(`afk ${name}`);
  });
});
