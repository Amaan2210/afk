import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentBinary } from "../../src/launch/resolve-binary.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "afk-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("resolveAgentBinary", () => {
  it("finds claude.exe on PATH and skips the afk package dir", () => {
    const afkRoot = tmp();
    const afkBin = join(afkRoot, "node_modules", ".bin");
    mkdirSync(afkBin, { recursive: true });
    writeFileSync(join(afkBin, "claude.cmd"), "");
    const binDir = tmp();
    writeFileSync(join(binDir, "claude.exe"), "");
    const env = { PATH: `${afkBin};${binDir}` };
    expect(resolveAgentBinary("claude", env, "win32", [afkRoot])).toBe(join(binDir, "claude.exe"));
  });

  it("returns undefined when absent", () => {
    expect(resolveAgentBinary("codex", { PATH: "" }, "win32")).toBeUndefined();
  });

  it("resolves an npm .cmd shim rather than the extensionless sh shim beside it", () => {
    const npmDir = tmp();
    writeFileSync(join(npmDir, "codex"), "#!/bin/sh");
    writeFileSync(join(npmDir, "codex.cmd"), "@ECHO off");
    expect(resolveAgentBinary("codex", { PATH: npmDir }, "win32")).toBe(join(npmDir, "codex.cmd"));
  });
});
