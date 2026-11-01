/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<Record<string, (p: Command) => void>>("../../src/cli/*.ts");
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

  it("documents every visible subcommand registered in src/cli.ts", async () => {
    // Read the registrations from the entry point, so a new command cannot be left out.
    const entry = readFileSync("src/cli.ts", "utf8");
    const imports = [...entry.matchAll(/import \{ (register\w+) \} from "\.\/(.+?)\.js"/g)];
    expect(imports.length).toBeGreaterThan(5);

    const program = new Command("afk").enablePositionalOptions();
    for (const [, fn, module] of imports) {
      const load = modules[`../../src/${module}.ts`];
      expect(load, `${module} exists`).toBeDefined();
      (await load?.())?.[fn as string]?.(program);
    }

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
