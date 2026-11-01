import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDeps, NOT_SET_UP, withDaemon, type RunDeps } from "../../src/cli/run.js";
import { afkPaths, type AfkPaths } from "../../src/daemon/paths.js";

let dir: string;
let paths: AfkPaths;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-cli-config-"));
  paths = afkPaths(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** withDaemon with the real config reading and connecting, against `paths`. */
async function run(): Promise<{ code: number | undefined; err: string; ran: boolean }> {
  let err = "";
  let code: number | undefined;
  let ran = false;
  const deps: RunDeps = {
    ...localDeps(paths),
    stdout: { write: () => undefined },
    stderr: { write: (s) => (err += s) },
    setExitCode: (c) => (code = c),
  };
  await withDaemon({}, async () => void (ran = true), deps);
  return { code, err, ran };
}

/** A port nobody listens on. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("client commands before the daemon was ever set up", () => {
  it("exit 2 with the setup hint when there is no config, and create nothing", async () => {
    expect(await run()).toEqual({ code: 2, err: `afk: ${NOT_SET_UP}\n`, ran: false });
    expect(await readdir(dir)).toEqual([]);
  });

  it("exit 2 with the setup hint when there is no local token, and mint none", async () => {
    await writeFile(paths.configFile, JSON.stringify({ port: await freePort() }));
    expect(await run()).toEqual({ code: 2, err: `afk: ${NOT_SET_UP}\n`, ran: false });
    expect(await readdir(dir)).toEqual(["config.json"]);
  });

  it("read the port from the config, leaving it as it is", async () => {
    const port = await freePort();
    const text = JSON.stringify({ port, localTokenHash: "x" });
    await writeFile(paths.configFile, text);
    await writeFile(paths.localTokenFile, "token\n");
    const r = await run();
    // Nobody listens there: the usual not-running answer, for that port.
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not running \(ECONNREFUSED\)/);
    expect((await readdir(dir)).sort()).toEqual(["config.json", "local-token"].sort());
  });
});
