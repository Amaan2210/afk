import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExec, type ExecIo } from "../../src/cli/exec.js";
import type { PostFn } from "../../src/cli/post.js";

interface SpawnCall {
  exe: string;
  args: string[];
  opts: { env: Record<string, string>; stdio: unknown };
}

const SHIM = path.resolve(import.meta.dirname, "../fixtures/shims/codex.cmd");

function harness(exitCode: number, env: NodeJS.ProcessEnv, binary = "/bin/agent") {
  const calls: { route: string; body: unknown }[] = [];
  const spawned: SpawnCall[] = [];
  const stderr: string[] = [];
  const post = (async (_port: number, route: string, body: unknown) => {
    calls.push({ route, body });
    return true;
  }) as PostFn;
  const spawn = ((exe: string, args: string[], opts: SpawnCall["opts"]) => {
    spawned.push({ exe, args, opts });
    const child = Object.assign(new EventEmitter(), { pid: 99 });
    setImmediate(() => child.emit("exit", exitCode, null));
    return child;
  }) as unknown as ExecIo["spawn"];
  const io: ExecIo = {
    env,
    post,
    spawn,
    resolveBinary: () => binary,
    stderr: { write: (t) => void stderr.push(t) },
    platform: "linux",
  };
  return { io, calls, spawned, stderr };
}

describe("runExec", () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "afk-exec-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const session = { AFK_SESSION_ID: "s_x", AFK_PORT: "4321", KEEP: "1" };

  it("posts agent-start, spawns codex with the injected notify, posts agent-exit with the code", async () => {
    const h = harness(7, session);
    h.io.configDir = dir;
    expect(await runExec("codex", ["--model", "x"], h.io)).toBe(7);
    expect(h.calls).toEqual([
      { route: "/sessions/s_x/agent-start", body: { kind: "codex", pid: 99 } },
      { route: "/sessions/s_x/agent-exit", body: { code: 7 } },
    ]);
    const call = h.spawned[0]!;
    expect(call.exe).toBe("/bin/agent");
    expect(call.args[0]).toBe("-c");
    expect(call.args[1]).toMatch(/^notify=\[".*","hook","codex-notify"\]$/);
    expect(call.args.slice(2)).toEqual(["--model", "x"]);
    expect(call.opts.stdio).toBe("inherit");
    expect(call.opts.env).toMatchObject({ KEEP: "1", AFK_SESSION_ID: "s_x", AFK_PORT: "4321" });
  });

  it("injects --settings for claude and writes the settings file under the session dir", async () => {
    const h = harness(0, session);
    h.io.configDir = dir;
    await runExec("claude", ["-p", "hi"], h.io);
    const args = h.spawned[0]!.args;
    expect(args[0]).toBe("--settings");
    expect(args[1]).toBe(path.join(dir, "sessions", "s_x", "claude-settings.json"));
    expect(existsSync(args[1]!)).toBe(true);
    expect(args.slice(2)).toEqual(["-p", "hi"]);
    expect(h.calls.map((c) => c.body)).toEqual([{ kind: "claude", pid: 99 }, { code: 0 }]);
  });

  it("without session env runs the binary unchanged and posts nothing", async () => {
    const h = harness(3, { KEEP: "1" });
    expect(await runExec("claude", ["--version"], h.io)).toBe(3);
    expect(h.spawned[0]!.args).toEqual(["--version"]);
    expect(h.calls).toEqual([]);
  });

  it("fails clearly when the binary is not on PATH", async () => {
    const h = harness(0, session);
    h.io.resolveBinary = () => undefined;
    expect(await runExec("claude", [], h.io)).toBe(127);
    expect(h.stderr.join("")).toContain("claude not found on PATH");
    expect(h.calls).toEqual([]);
    expect(h.spawned).toEqual([]);
  });

  it("maps a signal-killed child to 1", async () => {
    const h = harness(0, { KEEP: "1" });
    h.io.spawn = (() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("exit", null, "SIGTERM"));
      return child;
    }) as unknown as ExecIo["spawn"];
    expect(await runExec("codex", [], h.io)).toBe(1);
  });

  it("restores the interrupt handlers afterwards", async () => {
    const before = process.listenerCount("SIGINT");
    const h = harness(0, { KEEP: "1" });
    await runExec("codex", [], h.io);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("spawns an npm .cmd shim through node and its JS entry", async () => {
    const h = harness(0, { KEEP: "1" }, SHIM);
    h.io.platform = "win32";
    await runExec("codex", ["--version"], h.io);
    const call = h.spawned[0]!;
    expect(call.exe).toBe(process.execPath);
    expect(call.args[0]).toMatch(/@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
    expect(call.args.slice(1)).toEqual(["--version"]);
  });

  it("reports an unparseable .cmd shim and returns 1", async () => {
    const h = harness(0, { KEEP: "1" }, path.join(dir, "gone.cmd"));
    h.io.platform = "win32";
    expect(await runExec("codex", [], h.io)).toBe(1);
    expect(h.stderr.join("")).toContain("gone.cmd");
    expect(h.spawned).toEqual([]);
  });
});
