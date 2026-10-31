import { createRequire } from "node:module";

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
 * Spawns through node-pty with ConPTY. node-pty is required on first spawn rather than imported:
 * it loads a native addon at require time and ships no Linux prebuild, so importing this module
 * must not depend on that addon.
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
  });
  return {
    get pid() {
      return pty.pid;
    },
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
    // node-pty decodes UTF-8 statefully, so every string it hands over holds whole code points.
    onData: (cb) => void pty.onData((data) => cb(Buffer.from(data, "utf8"))),
    onExit: (cb) => void pty.onExit(({ exitCode }) => cb({ exitCode })),
  };
};
