import { nodePtyFactory } from "../../../src/daemon/sessions/pty.js";
import { SessionProcess } from "../../../src/daemon/sessions/session-process.js";

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

describe("SessionProcess on a real ConPTY", () => {
  it.skipIf(process.platform !== "win32")(
    "spawns PowerShell, echoes, snapshots, exits",
    async () => {
      const p = new SessionProcess({
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
      try {
        const out = await collectUntil(p, "afk-ok", 15000, () =>
          p.write(Buffer.from("Write-Output afk-ok\r")),
        );
        expect(out).toContain("afk-ok");
        expect(p.snapshot().data.toString()).toContain("afk-ok");
        p.write(Buffer.from("exit\r"));
        expect(await exitCode(p, 5000)).toBe(0);
      } finally {
        p.kill();
      }
    },
    30000,
  );
});
