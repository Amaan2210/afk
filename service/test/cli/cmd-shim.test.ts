import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveCmdShim } from "../../src/cli/cmd-shim.js";

const SHIM = path.resolve(import.meta.dirname, "../fixtures/shims/codex.cmd");

describe("resolveCmdShim", () => {
  it("finds the JS entry an npm shim runs", () => {
    const dir = path.resolve("npm-dir");
    const entry = resolveCmdShim(path.join(dir, "codex.cmd"), readFileSync(SHIM, "utf8"));
    expect(entry).toBe(path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"));
  });

  it("is undefined for text without a script target", () => {
    expect(resolveCmdShim("x.cmd", "@echo off\r\nnode.exe -v\r\n")).toBeUndefined();
  });

  it("is undefined for a file that does not exist", () => {
    expect(resolveCmdShim(path.join(import.meta.dirname, "nope.cmd"))).toBeUndefined();
  });
});
