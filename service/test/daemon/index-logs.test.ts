import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon, type Daemon } from "../../src/daemon/index.js";

let dir: string;
let daemon: Daemon | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-daemon-logs-"));
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({ bind: "loopback", shell: "powershell.exe" }),
  );
});

afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe("startDaemon and old logs", () => {
  it("deletes the log files last written more than 14 days ago", async () => {
    const logDir = join(dir, "logs");
    await mkdir(logDir);
    const day = 24 * 60 * 60 * 1000;
    for (const [name, days] of [
      ["afk-2020-01-01.log", 30],
      ["afk-2020-01-02.log", 2],
    ] as const) {
      await writeFile(join(logDir, name), "");
      const t = new Date(Date.now() - days * day);
      await utimes(join(logDir, name), t, t);
    }
    daemon = await startDaemon({ configDir: dir, port: 0 });
    const left = await readdir(logDir);
    expect(left).not.toContain("afk-2020-01-01.log");
    expect(left).toContain("afk-2020-01-02.log");
    expect(left).toContain(`afk-${new Date().toISOString().slice(0, 10)}.log`);
  });
});
