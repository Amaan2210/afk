import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderClaudeSettings } from "../../src/launch/claude-settings.js";
import { buildClaudeLaunch, buildCodexLaunch } from "../../src/launch/launch-spec.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "afk-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("buildClaudeLaunch", () => {
  it("buildClaudeLaunch writes settings and prepends --settings", async () => {
    const dir = tmp();
    const spec = await buildClaudeLaunch({
      sessionId: "s_x",
      port: 2350,
      nodeExe: "n",
      cliEntry: "c",
      sessionDir: dir,
      userArgs: ["--dangerously-skip-permissions"],
      realBinary: "C:\\u\\claude.exe",
    });
    expect(spec.exe).toBe("C:\\u\\claude.exe");
    expect(spec.args).toEqual([
      "--settings",
      join(dir, "claude-settings.json"),
      "--dangerously-skip-permissions",
    ]);
    expect(spec.env).toMatchObject({ AFK_SESSION_ID: "s_x", AFK_PORT: "2350" });
    expect(
      JSON.parse(readFileSync(join(dir, "claude-settings.json"), "utf8")).hooks.Stop,
    ).toBeDefined();
  });

  it("creates a missing session dir and writes exactly the rendered settings", async () => {
    const sessionDir = join(tmp(), "sessions", "s_x");
    const target = { nodeExe: "C:\\Program Files\\nodejs\\node.exe", cliEntry: "D:\\a b\\cli.js" };
    const spec = await buildClaudeLaunch({
      sessionId: "s_x",
      port: 2350,
      ...target,
      sessionDir,
      userArgs: [],
      realBinary: "claude",
    });
    const file = join(sessionDir, "claude-settings.json");
    expect(spec.filesWritten).toEqual([file]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(renderClaudeSettings(target));
  });
});

describe("buildCodexLaunch", () => {
  it("buildCodexLaunch injects notify via -c", () => {
    const spec = buildCodexLaunch({
      sessionId: "s_x",
      port: 2350,
      nodeExe: "C:\\n\\node.exe",
      cliEntry: "D:\\a b\\cli.js",
      sessionDir: "x",
      userArgs: ["--yolo"],
      realBinary: "codex",
    });
    expect(spec.args[0]).toBe("-c");
    expect(spec.args[1]).toBe(
      `notify=["C:\\\\n\\\\node.exe","D:\\\\a b\\\\cli.js","hook","codex-notify"]`,
    );
    expect(spec.args.slice(2)).toEqual(["--yolo"]);
  });

  it("escapes double quotes for TOML, writes no files and sets the session env", () => {
    const spec = buildCodexLaunch({
      sessionId: "s_x",
      port: 2350,
      nodeExe: '/opt/"n"/node',
      cliEntry: "/a/cli.js",
      sessionDir: "x",
      userArgs: [],
      realBinary: "codex",
    });
    expect(spec.args).toEqual([
      "-c",
      `notify=["/opt/\\"n\\"/node","/a/cli.js","hook","codex-notify"]`,
    ]);
    expect(spec.exe).toBe("codex");
    expect(spec.env).toEqual({ AFK_SESSION_ID: "s_x", AFK_PORT: "2350" });
    expect(spec.filesWritten).toEqual([]);
  });
});
