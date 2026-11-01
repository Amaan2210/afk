import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { afkPaths, defaultConfigDir } from "../daemon/paths.js";
import { buildClaudeLaunch, buildCodexLaunch, type LaunchContext } from "../launch/launch-spec.js";
import { resolveAgentBinary } from "../launch/resolve-binary.js";
import { CLI_ENTRY } from "../util/cli-entry.js";
import { resolveCmdShim } from "./cmd-shim.js";
import { portFromEnv, type PostFn } from "./post.js";

const NOT_FOUND = 127;
const POST_TIMEOUT_MS = 1500;

export interface ExecIo {
  env: NodeJS.ProcessEnv;
  post: PostFn;
  spawn?: typeof nodeSpawn;
  /** The real agent executable; defaults to a PATH lookup that skips the afk package. */
  resolveBinary?: (agent: "claude" | "codex", env: NodeJS.ProcessEnv) => string | undefined;
  /** Where session directories live; defaults to the platform config dir. */
  configDir?: string;
  platform?: NodeJS.Platform;
  stderr?: { write(text: string): unknown };
}

type Target = { exe: string; prefix: string[] } | { error: string };

/** npm `.cmd` shims run through their JS entry: `shell: true` would let cmd.exe mangle `-c`. */
function spawnTarget(binary: string, platform: NodeJS.Platform): Target {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    const entry = resolveCmdShim(binary);
    if (entry === undefined) return { error: `afk: cannot find the script that ${binary} runs` };
    return { exe: process.execPath, prefix: [entry] };
  }
  return { exe: binary, prefix: [] };
}

/** Ctrl+C reaches the agent through the console; this wrapper must outlive it. */
function ignoreInterrupts(): () => void {
  const noop = (): void => undefined;
  process.on("SIGINT", noop);
  process.on("SIGBREAK", noop);
  return () => {
    process.off("SIGINT", noop);
    process.off("SIGBREAK", noop);
  };
}

/**
 * `afk exec <agent> ...`: starts the real agent with this session's hooks injected, tells the
 * daemon it started and exited, and returns the agent's exit code. Without the session
 * environment it just runs the agent unchanged.
 */
export async function runExec(
  agent: "claude" | "codex",
  args: string[],
  io: ExecIo,
): Promise<number> {
  const stderr = io.stderr ?? process.stderr;
  const binary = (io.resolveBinary ?? resolveAgentBinary)(agent, io.env);
  if (binary === undefined) {
    stderr.write(`${agent} not found on PATH\n`);
    return NOT_FOUND;
  }
  const sessionId = io.env.AFK_SESSION_ID;
  const port = portFromEnv(io.env);

  let exe = binary;
  let argv = args;
  let extraEnv: Record<string, string> = {};
  if (sessionId && io.env.AFK_PORT) {
    const ctx: LaunchContext = {
      sessionId,
      port,
      nodeExe: process.execPath,
      cliEntry: CLI_ENTRY,
      sessionDir: path.join(
        afkPaths(io.configDir ?? defaultConfigDir(io.env)).sessionsDir,
        sessionId,
      ),
      userArgs: args,
      realBinary: binary,
    };
    const spec = agent === "claude" ? await buildClaudeLaunch(ctx) : buildCodexLaunch(ctx);
    ({ exe, args: argv, env: extraEnv } = spec);
  }

  const target = spawnTarget(exe, io.platform ?? process.platform);
  if ("error" in target) {
    stderr.write(`${target.error}\n`);
    return 1;
  }

  const restore = ignoreInterrupts();
  try {
    const child = (io.spawn ?? nodeSpawn)(target.exe, [...target.prefix, ...argv], {
      stdio: "inherit",
      env: { ...io.env, ...extraEnv },
    });
    const exited = new Promise<number>((resolve) => {
      child.once("error", (err) => {
        stderr.write(`afk: could not start ${agent}: ${err.message}\n`);
        resolve(1);
      });
      child.once("exit", (code) => resolve(code ?? 1));
    });
    const base = `/sessions/${sessionId}`;
    const tracked = Boolean(sessionId && io.env.AFK_PORT);
    if (tracked) {
      const body = { kind: agent, pid: child.pid };
      await io.post(port, `${base}/agent-start`, body, {}, POST_TIMEOUT_MS);
    }
    const code = await exited;
    if (tracked) await io.post(port, `${base}/agent-exit`, { code }, {}, POST_TIMEOUT_MS);
    return code;
  } finally {
    restore();
  }
}
