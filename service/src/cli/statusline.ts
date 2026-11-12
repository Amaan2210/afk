import { spawn as nodeSpawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { isRecord } from "../util/is-record.js";
import { portFromEnv, type PostFn } from "./post.js";
import { parseJson, readStdin } from "./read-stdin.js";
import { findGitBash, findOriginalStatusline } from "./statusline-original.js";

export interface StatuslineIo {
  stdin: Readable;
  stdout: Writable;
  env: NodeJS.ProcessEnv;
  post: PostFn;
  userSettingsPath?: string;
  spawn?: typeof nodeSpawn;
  platform?: NodeJS.Platform;
  cwd?: string;
}

const POST_TIMEOUT_MS = 1200;

function projectDirOf(json: unknown, fallback: string): string {
  if (isRecord(json)) {
    const ws = json.workspace;
    if (isRecord(ws) && typeof ws.project_dir === "string") return ws.project_dir;
    if (typeof json.cwd === "string") return json.cwd;
  }
  return fallback;
}

/** Runs the user's own status line command with the JSON on stdin; its stdout goes to `io.stdout`. */
function runOriginal(command: string, input: string, io: StatuslineIo): Promise<void> {
  const spawn = io.spawn ?? nodeSpawn;
  const bash = (io.platform ?? process.platform) === "win32" ? findGitBash(io.env) : undefined;
  const stdio: ["pipe", "pipe", "ignore"] = ["pipe", "pipe", "ignore"];
  return new Promise((resolve) => {
    try {
      const child =
        bash !== undefined
          ? spawn(bash, ["-c", command], { stdio, windowsHide: true, env: io.env })
          : spawn(command, { shell: true, stdio, windowsHide: true, env: io.env });
      child.on("error", () => resolve());
      child.on("close", () => resolve());
      child.stdout.on("data", (c: Buffer) => void io.stdout.write(c));
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    } catch {
      resolve();
    }
  });
}

/**
 * Relays the status-line JSON to the daemon, then to the status line the user had before AFK took
 * the slot, unless the daemon says a phone is showing this terminal (`hideOriginal`): those lines
 * are cut off there. A daemon that does not answer in time counts as no phone. Always returns 0.
 */
export async function runStatusline(io: StatuslineIo): Promise<number> {
  try {
    const input = await readStdin(io.stdin);
    const json = parseJson(input);
    const sessionId = io.env.AFK_SESSION_ID;
    let hide = false;
    if (sessionId && json !== undefined) {
      // The relay's own limit too: a post that never settles must not hold the status line back.
      const limit = new Promise<void>((resolve) => setTimeout(resolve, POST_TIMEOUT_MS).unref());
      const post = io.post(
        portFromEnv(io.env),
        "/statusline",
        json,
        { "X-AFK-Session": sessionId },
        POST_TIMEOUT_MS,
        (reply) => {
          hide = isRecord(reply) && reply.hideOriginal === true;
        },
      );
      await Promise.race([post, limit]);
    }
    if (hide) return 0;
    const command = findOriginalStatusline({
      projectDir: projectDirOf(json, io.cwd ?? process.cwd()),
      env: io.env,
      userSettingsPath: io.userSettingsPath,
    });
    if (command !== undefined) await runOriginal(command, input, io);
  } catch {
    // A relay never fails the agent.
  }
  return 0;
}
