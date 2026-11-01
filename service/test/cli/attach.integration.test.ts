import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAttach } from "../../src/cli/attach-cmd.js";
import { DaemonClient } from "../../src/cli/client.js";
import { launch } from "../../src/cli/launch.js";
import { startDaemon, type Daemon } from "../../src/daemon/index.js";
import { afkPaths } from "../../src/daemon/paths.js";
import { fakeTerminal } from "../helpers/fake-attach.js";

const onWindows = it.skipIf(process.platform !== "win32");
const WAIT = { timeout: 20_000, interval: 50 };

let dir: string;
let daemon: Daemon | undefined;
const clients: DaemonClient[] = [];

async function connect(): Promise<DaemonClient> {
  const client = await DaemonClient.connectLocal(afkPaths(dir), daemon?.port ?? 0);
  clients.push(client);
  return client;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-attach-"));
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({ bind: "loopback", shell: "powershell.exe" }),
  );
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await daemon?.stop();
  daemon = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe("attach against a live daemon", () => {
  onWindows(
    "afk shell, detach, reattach by name to the same screen, then exit with the shell's code",
    async () => {
      daemon = await startDaemon({ configDir: dir, port: 0 });
      const first = fakeTerminal({ columns: 100, rows: 30 });
      const launched = launch("shell", [], {
        cwd: dir,
        client: await connect(),
        name: "itest",
        ...first.io,
      });
      await vi.waitFor(() => expect(first.text()).toContain("detach: Ctrl+] d"), WAIT);
      first.type("echo marker-$((6*7))\r");
      await vi.waitFor(() => expect(first.text()).toContain("marker-42"), WAIT);
      first.type([0x1d, 0x64]);
      expect(await launched).toBe(0);
      expect(first.text()).toContain("[afk] detached, session itest keeps running");

      const again = fakeTerminal({ columns: 100, rows: 30 });
      const attached = runAttach("itest", await connect(), again.io);
      await vi.waitFor(() => expect(again.text()).toContain("marker-42"), WAIT);
      again.type("exit 3\r");
      expect(await attached).toBe(3);
      expect(again.text()).toContain("[afk] session ended (exit 3)");
    },
    60_000,
  );
});
