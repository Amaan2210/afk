import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Command } from "commander";
import { loadConfig } from "../daemon/config.js";
import { readPid } from "../daemon/lock.js";
import { afkPaths, defaultConfigDir, type AfkPaths } from "../daemon/paths.js";
import { CLI_ENTRY } from "../util/cli-entry.js";
import { parsePortOption, type Output } from "./run.js";
import {
  currentUserId,
  isAccessDenied,
  isNotFound,
  schtasksArgs,
  TASK_NAME,
  taskStatus,
  taskXml,
} from "./schtasks.js";

export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "status";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr?: string;
}

/** What `runService` uses; everything past `stdout` has a default for the real machine. */
export interface ServiceIo {
  /** Runs a program; resolves with its exit code and output, never rejects. */
  exec: (file: string, args: string[]) => Promise<ExecResult>;
  stdout: Output;
  /** Errors and warnings (default: process.stderr). */
  stderr?: Output;
  platform?: string;
  /** The daemon's port, for the health probe (default: the configured one). */
  port?: number;
  paths?: AfkPaths;
  /** Whether a daemon answers `GET /health` on the port (default: a 1 s probe of 127.0.0.1). */
  isUp?: (port: number) => Promise<boolean>;
  nodeExe?: string;
  cliEntry?: string;
  /** Whose logon starts the task (default: the current user, `DOMAIN\user`). */
  userId?: string;
  /** How long stop and uninstall wait for the daemon to stop answering (default 5 s). */
  stopWaitMs?: number;
  /** How often they look meanwhile (default 250 ms). */
  pollMs?: number;
}

const SCHTASKS = "schtasks.exe";
const HEALTH_TIMEOUT_MS = 1000;
const STOP_WAIT_MS = 5000;
const POLL_MS = 250;

/** Runs `file`; a failure to start it at all resolves as code 1 with the error as its stderr. */
export function execProgram(file: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err === null) return resolve({ code: 0, stdout, stderr });
      const code = typeof err.code === "number" ? err.code : 1;
      resolve({ code, stdout, stderr: stderr || err.message });
    });
  });
}

/** Whether a daemon answers `GET /health` on 127.0.0.1:`port` within `timeoutMs`. Never rejects. */
export function isDaemonUp(port: number, timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const options = { host: "127.0.0.1", port, path: "/health", agent: false, timeout: timeoutMs };
    const req = get(options, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

type Verb = "create" | "start" | "stop" | "remove";

/** `io` with its defaults filled in, and the few things every action does. */
class Service {
  readonly paths: AfkPaths;
  private readonly isUp: (port: number) => Promise<boolean>;

  constructor(private readonly io: ServiceIo) {
    this.paths = io.paths ?? afkPaths(defaultConfigDir());
    this.isUp = io.isUp ?? ((port) => isDaemonUp(port));
  }

  out(line: string): void {
    this.io.stdout.write(`${line}\n`);
  }

  warn(line: string): void {
    (this.io.stderr ?? process.stderr).write(`${line}\n`);
  }

  schtasks(args: string[]): Promise<ExecResult> {
    return this.io.exec(SCHTASKS, args);
  }

  async port(): Promise<number> {
    return this.io.port ?? (await loadConfig(this.paths)).port;
  }

  /** Writes the task XML to a temporary file for `/Create`, and removes it however that ends. */
  async create(): Promise<ExecResult> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "afk-task-"));
    try {
      const xmlFile = path.join(dir, "afk-daemon.xml");
      const xml = taskXml({
        nodeExe: this.io.nodeExe ?? process.execPath,
        cliEntry: this.io.cliEntry ?? CLI_ENTRY,
        userId: this.io.userId ?? currentUserId(),
      });
      // UTF-16LE with a BOM, the encoding schtasks itself exports task XML in.
      const bom = Buffer.from([0xff, 0xfe]);
      await writeFile(xmlFile, Buffer.concat([bom, Buffer.from(xml, "utf16le")]));
      return await this.schtasks(schtasksArgs("create", { xmlFile }));
    } finally {
      // A temp file left behind (antivirus holding it, say) must not fail a created task.
      await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  }

  /** Runs the task, unless a daemon (the task's or one started by hand) already answers. */
  async startUnlessUp(): Promise<number> {
    const port = await this.port();
    if (await this.isUp(port)) {
      this.out(
        `A daemon is already running on port ${port}, so the task was not started again. If that ` +
          "one was started by hand, the task takes over once it stops: at your next logon, or " +
          "with `afk service start`.",
      );
      return 0;
    }
    const run = await this.schtasks(schtasksArgs("run"));
    if (run.code !== 0) return this.failed("start", run);
    this.out("Started the daemon.");
    return 0;
  }

  /** Whether the daemon stopped answering within the wait. */
  async waitUntilDown(port: number): Promise<boolean> {
    const deadline = Date.now() + (this.io.stopWaitMs ?? STOP_WAIT_MS);
    for (;;) {
      if (!(await this.isUp(port))) return true;
      if (Date.now() >= deadline) return false;
      await sleep(this.io.pollMs ?? POLL_MS);
    }
  }

  async stillRunning(port: number): Promise<number> {
    const pid = await readPid(this.paths.lockFile);
    const which = pid === undefined ? "" : ` (pid ${pid})`;
    const kill = pid === undefined ? "" : `, or run \`taskkill /PID ${pid}\``;
    this.warn(
      `A daemon is still answering on port ${port}${which}: it was started some other way ` +
        `(such as \`afk daemon\`), or it did not stop. Stop it with Ctrl+C in its window${kill}.`,
    );
    return 1;
  }

  /** Explains a failed schtasks call on stderr; returns the exit code 1. */
  failed(verb: Verb, result: ExecResult): number {
    const text = `${result.stdout}${result.stderr ?? ""}`.trim();
    if (verb !== "create" && isNotFound(text)) {
      const hint = verb === "remove" ? "" : " Run `afk service install` first.";
      this.warn(`The scheduled task "${TASK_NAME}" is not installed.${hint}`);
    } else if (isAccessDenied(text)) {
      this.warn(
        `Windows refused to ${verb} the scheduled task "${TASK_NAME}" (access is denied). ` +
          "Run this command again from an elevated terminal (Run as administrator).",
      );
    } else {
      const detail = text === "" ? `schtasks exited with code ${result.code}` : text;
      this.warn(`Could not ${verb} the scheduled task "${TASK_NAME}": ${detail}`);
    }
    return 1;
  }
}

async function install(s: Service): Promise<number> {
  const created = await s.create();
  if (created.code !== 0) return s.failed("create", created);
  s.out(
    `Installed the scheduled task "${TASK_NAME}": the daemon runs in the background from logon.`,
  );
  const started = await s.startUnlessUp();
  if (started !== 0) return started;
  s.out("Next: run `afk pair` to pair your phone.");
  return 0;
}

async function stop(s: Service): Promise<number> {
  const ended = await s.schtasks(schtasksArgs("end"));
  if (ended.code !== 0) return s.failed("stop", ended);
  const port = await s.port();
  if (!(await s.waitUntilDown(port))) return s.stillRunning(port);
  s.out("Stopped the daemon.");
  return 0;
}

/** The task is deleted even when its daemon does not stop: the user asked for it to go. */
async function uninstall(s: Service): Promise<number> {
  // Fails when the task is not running or not installed; either way there is nothing to end.
  await s.schtasks(schtasksArgs("end"));
  const port = await s.port();
  const down = await s.waitUntilDown(port);
  const deleted = await s.schtasks(schtasksArgs("delete"));
  let code = 0;
  if (deleted.code === 0) {
    s.out(`Removed the scheduled task "${TASK_NAME}": the daemon no longer starts at logon.`);
  } else {
    code = s.failed("remove", deleted);
  }
  return down ? code : s.stillRunning(port);
}

async function status(s: Service): Promise<number> {
  const query = await s.schtasks(schtasksArgs("query"));
  if (query.code !== 0) {
    s.out("Not installed");
    return 1;
  }
  if (taskStatus(query.stdout) === "Running") {
    s.out("Running");
    return 0;
  }
  s.out("Not running");
  s.out(`Logs: ${s.paths.logDir}`);
  return 1;
}

/**
 * Manages the scheduled task that runs the daemon from logon, hidden: `install` creates and starts
 * it, `uninstall` stops and removes it, `start`, `stop`, and `status` (Running, exit 0; Not
 * running or Not installed, exit 1). Resolves to the exit code.
 */
export async function runService(action: ServiceAction, io: ServiceIo): Promise<number> {
  const s = new Service(io);
  if ((io.platform ?? process.platform) !== "win32") {
    s.warn(
      "`afk service` sets up a Windows scheduled task, so it works on Windows only. Elsewhere, " +
        "run `afk daemon`, under your own service manager to keep it running.",
    );
    return 1;
  }
  switch (action) {
    case "install":
      return install(s);
    case "uninstall":
      return uninstall(s);
    case "start":
      return s.startUnlessUp();
    case "stop":
      return stop(s);
    case "status":
      return status(s);
  }
}

const ACTIONS: [ServiceAction, string][] = [
  ["install", "create the scheduled task that runs the daemon from logon, and start it"],
  ["uninstall", "stop the daemon and remove the scheduled task; this ends every session"],
  ["start", "start the daemon from the scheduled task"],
  ["stop", "stop the daemon the scheduled task runs; this ends every session"],
  ["status", "print whether the scheduled task's daemon is running"],
];

export function registerServiceCommand(program: Command): void {
  const service = program
    .command("service")
    .description("run the daemon in the background from logon (a Windows scheduled task)");
  for (const [action, description] of ACTIONS) {
    const command = service.command(action).description(description);
    if (action !== "status") {
      command.option(
        "--port <n>",
        "the port to check for a running daemon (default: the configured one)",
        parsePortOption,
      );
    }
    command.action(async (opts: { port?: number }) => {
      const io = { exec: execProgram, stdout: process.stdout, port: opts.port };
      process.exitCode = await runService(action, io);
    });
  }
}
