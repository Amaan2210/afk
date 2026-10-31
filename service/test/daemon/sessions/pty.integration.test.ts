import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nodePtyFactory } from "../../../src/daemon/sessions/pty.js";
import { SessionProcess } from "../../../src/daemon/sessions/session-process.js";

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const onWindows = it.skipIf(process.platform !== "win32");

/** Resolves with all output so far once it contains `needle`; `start` runs after subscribing. */
function collectUntil(
  p: SessionProcess,
  needle: string,
  timeoutMs: number,
  start: () => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => {
      off();
      reject(
        new Error(`no ${JSON.stringify(needle)} within ${timeoutMs} ms: ${JSON.stringify(text)}`),
      );
    }, timeoutMs);
    const off = p.onData((chunk) => {
      text += chunk.toString("utf8");
      if (!text.includes(needle)) return;
      clearTimeout(timer);
      off();
      resolve(text);
    });
    start();
  });
}

function exitCode(p: SessionProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no exit within ${timeoutMs} ms`)), timeoutMs);
    p.onExit((code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function spawnPowerShell(): SessionProcess {
  return new SessionProcess({
    exe: "powershell.exe",
    args: ["-NoLogo", "-NoProfile"],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    cols: 80,
    rows: 24,
    ptyFactory: nodePtyFactory,
    ringBufferBytes: 1 << 20,
    snapshotScrollback: 200,
  });
}

/** Pseudoconsole hosts that are children of this process: OpenConsole.exe or conhost.exe. */
async function consoleHosts(): Promise<string[]> {
  const script =
    `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | ` +
    `Where-Object { $_.Name -in 'OpenConsole.exe', 'conhost.exe' } | ` +
    `ForEach-Object { $_.Name + ' ' + $_.ProcessId }`;
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
    },
  );
  return stdout.split(/\r?\n/).filter((line) => line.length > 0);
}

/** Polls until no pseudoconsole host child is left or `withinMs` has passed; returns what is left. */
async function consoleHostsLeftAfter(withinMs: number): Promise<string[]> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const left = await consoleHosts();
    if (left.length === 0 || Date.now() >= deadline) return left;
    await sleep(200);
  }
}

describe("SessionProcess on a real ConPTY", () => {
  onWindows(
    "spawns PowerShell, echoes, snapshots, exits",
    async () => {
      const p = spawnPowerShell();
      try {
        // The shell's echo of the typed command cannot contain the needle; only its output can.
        const out = await collectUntil(p, "afk-ok", 15000, () =>
          p.write(Buffer.from("Write-Output ('afk-' + 'ok')\r")),
        );
        expect(out).toContain("afk-ok");
        expect(p.snapshot().data.toString()).toContain("afk-ok");
        expect(await consoleHosts()).not.toEqual([]);
        p.write(Buffer.from("exit\r"));
        expect(await exitCode(p, 5000)).toBe(0);
        expect(await consoleHostsLeftAfter(3000)).toEqual([]);
      } finally {
        p.kill();
      }
    },
    30000,
  );

  onWindows(
    "kill ends a live shell and its console host",
    async () => {
      const p = spawnPowerShell();
      try {
        await collectUntil(p, "PS ", 15000, () => {});
        expect(await consoleHosts()).not.toEqual([]);
        const exited = exitCode(p, 5000);
        p.kill();
        expect(Number.isInteger(await exited)).toBe(true);
        expect(await consoleHostsLeftAfter(3000)).toEqual([]);
      } finally {
        p.kill();
      }
    },
    30000,
  );

  // "orphan": the shell exits while a process it started still writes to the console. With the
  // system ConPTY, node-pty 1.1.0 crashes its host with an uncaught EPIPE in that case.
  onWindows.each([
    { mode: "exit", printed: /^exit 7\r?\n$/ },
    { mode: "kill", printed: /^exit -?\d+\r?\n$/ },
    { mode: "orphan", printed: /^exit 0 after late-output\r?\n$/ },
  ])(
    "a process whose pty ends by $mode exits by itself, with nothing left holding it open",
    async ({ mode, printed }) => {
      const fixture = "test/fixtures/pty-release.ts";
      const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", fixture, mode], {
        cwd: process.cwd(),
        timeout: 20000,
        windowsHide: true,
      });
      expect(stderr).toBe("");
      expect(stdout).toMatch(printed);
    },
    30000,
  );
});
