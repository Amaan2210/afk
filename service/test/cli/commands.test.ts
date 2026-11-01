import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../../src/cli/client.js";
import { runDevices, runUnpair } from "../../src/cli/devices.js";
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

  it("kill reports the daemon's not_found for an unknown session", async () => {
    await expect(runKill("s_nope", io)).rejects.toMatchObject({ code: "not_found" });
    expect(text).toBe("");
  });

  it("devices lists a paired device and unpair removes it", async () => {
    await runDevices(io);
    expect(text).toContain("No paired devices");

    const { deviceId } = await client.request<{ deviceId: string }>({
      type: "device.add",
      name: "Pixel",
    });
    text = "";
    await runDevices(io);
    const row = text.split("\n")[1] ?? "";
    expect(text.split("\n")[0]).toMatch(/^ID\s+NAME\s+PAIRED\s+LAST SEEN$/);
    expect(row).toMatch(new RegExp(`^${deviceId}\\s+Pixel\\s+\\d+s\\s+never$`));

    text = "";
    await runUnpair(deviceId, io);
    expect(text).toBe(`Unpaired ${deviceId}.\n`);
    text = "";
    await runDevices(io);
    expect(text).toContain("No paired devices");
  });

  it("unpair reports the daemon's error for an unknown device", async () => {
    await expect(runUnpair("dev_nope", io)).rejects.toMatchObject({ code: "not_found" });
  });
});
