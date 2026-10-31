import { createRequire } from "node:module";
import type { IDisposable, IPty } from "node-pty";

/** The slice of a pseudo-terminal a session needs. Output arrives as raw bytes. */
export interface PtyLike {
  readonly pid: number;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: Buffer) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}

export interface PtySpawnOptions {
  exe: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export type PtyFactory = (o: PtySpawnOptions) => PtyLike;

const requireCjs = createRequire(import.meta.url);

/**
 * Spawns through node-pty. node-pty is required on first spawn rather than imported: it loads a
 * native addon at require time and ships no Linux prebuild, so importing this module must not
 * depend on that addon.
 *
 * `useConptyDll` runs the conpty.dll and OpenConsole.exe that node-pty bundles instead of the
 * system ConPTY, where node-pty 1.1.0 has three problems:
 * - After a natural exit it never closes the pseudoconsole (its native exit thread drops the
 *   handle before JavaScript hears of the exit), so a conhost.exe outlives every session.
 * - It destroys its output socket one second after the shell exits, so later output from a
 *   process the shell started is lost, or crashes the host with an uncaught EPIPE from node-pty's
 *   output worker.
 * - `kill()` forks a helper that prints an "AttachConsole failed" stack.
 *
 * The bundled host exits by itself and closes the output pipe once the last console process is
 * gone, so `onExit` fires when the whole console has ended, not just the shell.
 */
export const nodePtyFactory: PtyFactory = (o) => {
  const { spawn } = requireCjs("node-pty") as typeof import("node-pty");
  const pty = spawn(o.exe, o.args, {
    name: "xterm-256color",
    cols: o.cols,
    rows: o.rows,
    cwd: o.cwd,
    env: o.env,
    useConpty: true,
    useConptyDll: true,
  });
  return adaptNodePty(pty, process.platform);
};

/** node-pty's resize throws this from the moment the process exits, before it emits exit. */
const RESIZE_AFTER_EXIT = /already exited/;

/** Wraps a node-pty `IPty` as a `PtyLike`. Exported for tests. */
export function adaptNodePty(pty: IPty, platform: NodeJS.Platform): PtyLike {
  const subscriptions: IDisposable[] = [];
  let exited = false;
  subscriptions.push(
    pty.onExit(() => {
      exited = true;
      if (platform === "win32") releaseConpty(pty);
      // node-pty fires exit listeners from a copy, so the ones disposed here still run.
      for (const s of subscriptions) s.dispose();
    }),
  );
  return {
    get pid() {
      return pty.pid;
    },
    write: (data) => pty.write(data),
    resize: (cols, rows) => {
      try {
        pty.resize(cols, rows);
      } catch (err) {
        if (!(err instanceof Error && RESIZE_AFTER_EXIT.test(err.message))) throw err;
      }
    },
    // After exit everything is already released, and node-pty's kill would only touch closed handles.
    kill: () => {
      if (!exited) pty.kill();
    },
    // node-pty decodes UTF-8 statefully, so every string it hands over holds whole code points.
    onData: (cb) => void subscriptions.push(pty.onData((data) => cb(Buffer.from(data, "utf8")))),
    onExit: (cb) => void subscriptions.push(pty.onExit(({ exitCode }) => cb({ exitCode }))),
  };
}

/** The private parts of node-pty 1.1.0's `WindowsTerminal` that `releaseConpty` closes. */
interface WindowsPtyInternals {
  _agent?: {
    _inSocket?: { destroy?: () => void };
    _conoutSocketWorker?: { dispose?: () => void };
  };
}

let warnedMissingInternals = false;

/**
 * node-pty 1.1.0 (pinned exactly because of this) leaves two things open after a Windows pty
 * exits, each holding a handle and keeping the event loop alive for good:
 * - the input pipe (`_agent._inSocket`), which only `kill()` destroys, never a natural exit;
 * - the worker thread relaying output (`_agent._conoutSocketWorker`), which in conpty.dll mode
 *   only `kill()` disposes, and only once more output arrives, which after exit it never does.
 *
 * No public API reaches either, so this closes both through node-pty's internals. If a node-pty
 * upgrade moved them, it warns once instead of failing.
 */
function releaseConpty(pty: IPty): void {
  const agent = (pty as IPty & WindowsPtyInternals)._agent;
  const input = agent?._inSocket;
  const worker = agent?._conoutSocketWorker;
  if (typeof input?.destroy === "function") input.destroy();
  if (typeof worker?.dispose === "function") worker.dispose();
  if (typeof input?.destroy === "function" && typeof worker?.dispose === "function") return;
  if (warnedMissingInternals) return;
  warnedMissingInternals = true;
  process.emitWarning(
    "node-pty internals changed: a finished pty's input pipe or output worker could not be " +
      "released, so each ended session leaks them",
    { code: "AFK_PTY_RELEASE" },
  );
}
