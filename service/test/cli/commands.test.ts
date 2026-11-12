import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../../src/cli/client.js";
import { runDevices } from "../../src/cli/devices.js";
import { runKill } from "../../src/cli/kill.js";
import { runLs } from "../../src/cli/ls.js";
import type { CommandIo } from "../../src/cli/run.js";
import { startDaemon, type Daemon } from "../../src/daemon/index.js";
import { afkPaths } from "../../src/daemon/paths.js";

let dir: string;
let daemon: Daemon;
let client: DaemonClient;
let text: string;
let io: CommandIo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-cmd-"));
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({ bind: "loopback", shell: "powershell.exe" }),
  );
  daemon = await startDaemon({ configDir: dir, port: 0 });
  client = await DaemonClient.connectLocal(afkPaths(dir), daemon.port);
  text = "";
  io = { stdout: { write: (s) => (text += s) }, client, port: daemon.port };
});

afterEach(async () => {
  client.close();
  await daemon.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("commands against a live daemon", () => {
  it("ls says there are no sessions", async () => {
    await runLs(io);
    expect(text).toBe("No sessions.\n");
  });

  it("kill refuses a session nobody has, by id or by name", async () => {
    await expect(runKill("s_nope", io)).rejects.toThrow(/There is no session "s_nope"/);
    expect(text).toBe("");
  });

  it("kill with no target and outside a session asks for one", async () => {
    await expect(runKill(undefined, io, {})).rejects.toThrow(/afk kill <id or name>/);
  });

  it("devices shows the paired phone, and a second pairing replaces the first", async () => {
    await runDevices(io);
    expect(text).toContain("No phone is paired");

    await client.request({ type: "device.add", name: "Pixel" });
    await client.request({ type: "device.add", name: "Galaxy" });
    text = "";
    await runDevices(io);
    const [header, row, ...rest] = text.trimEnd().split("\n");
    expect(header).toMatch(/^PHONE\s+PAIRED\s+LAST CONNECTED$/);
    expect(row).toMatch(/^Galaxy\s+\d+s ago\s+never$/);
    expect(rest).toEqual([]);
  });
});
