import { InvalidArgumentError } from "commander";
import { DaemonError, DaemonNotRunningError, type DaemonClient } from "../../src/cli/client.js";
import {
  CliError,
  NOT_RUNNING_HINT,
  parsePortOption,
  withDaemon,
  type RunDeps,
} from "../../src/cli/run.js";
import { afkPaths } from "../../src/daemon/paths.js";

function setup(connect?: RunDeps["connect"]): {
  deps: RunDeps;
  err: () => string;
  exit: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  loadPort: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
} {
  let err = "";
  const close = vi.fn();
  const exit = vi.fn();
  const loadPort = vi.fn(async () => 2350);
  const connectFn = vi.fn(connect ?? (async () => ({ close }) as unknown as DaemonClient));
  const deps: RunDeps = {
    paths: afkPaths("/cfg"),
    loadPort,
    connect: connectFn,
    stdout: { write: () => undefined },
    stderr: { write: (s) => (err += s) },
    setExitCode: exit,
  };
  return { deps, err: () => err, exit, close, loadPort, connect: connectFn };
}

describe("withDaemon", () => {
  it("runs the command, leaves the exit code alone, and closes the client", async () => {
    const s = setup();
    const command = vi.fn(async () => undefined);
    await withDaemon({}, command, s.deps);
    expect(command).toHaveBeenCalledOnce();
    expect(s.exit).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("uses --port over the configured port", async () => {
    const s = setup();
    await withDaemon({ port: 4000 }, async () => undefined, s.deps);
    expect(s.loadPort).not.toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalledWith(s.deps.paths, 4000);
  });

  it("uses the configured port when --port is absent, and tells the command", async () => {
    const s = setup();
    let seen = 0;
    await withDaemon({}, async (io) => void (seen = io.port), s.deps);
    expect(s.connect).toHaveBeenCalledWith(s.deps.paths, 2350);
    expect(seen).toBe(2350);
  });

  it("exits 2 with the hint when no daemon is running", async () => {
    const s = setup(async () => {
      throw new DaemonNotRunningError("ECONNREFUSED");
    });
    await withDaemon({}, async () => undefined, s.deps);
    expect(s.exit).toHaveBeenCalledWith(2);
    expect(s.err()).toContain("not running");
    expect(s.err()).toContain(NOT_RUNNING_HINT);
    expect(NOT_RUNNING_HINT).toMatch(/afk service install.*afk daemon/);
  });

  it("exits 1 with the reason when the daemon refuses", async () => {
    const s = setup(async () => {
      throw new DaemonError("unauthorized", "bad token");
    });
    await withDaemon({}, async () => undefined, s.deps);
    expect(s.exit).toHaveBeenCalledWith(1);
    expect(s.err()).toBe("afk: bad token\n");
  });

  it("passes a CliError code through and still closes the client", async () => {
    const s = setup();
    await withDaemon({}, async () => Promise.reject(new CliError("nope", 7)), s.deps);
    expect(s.exit).toHaveBeenCalledWith(7);
    expect(s.err()).toBe("afk: nope\n");
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("exits 1 for any other error from the command", async () => {
    const s = setup();
    await withDaemon({}, async () => Promise.reject(new Error("boom")), s.deps);
    expect(s.exit).toHaveBeenCalledWith(1);
    expect(s.close).toHaveBeenCalledOnce();
  });
});

describe("parsePortOption", () => {
  it.each([
    ["1", 1],
    ["2350", 2350],
    ["65535", 65535],
  ])("accepts %j", (text, port) => expect(parsePortOption(text)).toBe(port));

  it.each(["0", "65536", "-1", "abc", "", "1.5", " 80", "0x10"])("rejects %j", (text) =>
    expect(() => parsePortOption(text)).toThrow(InvalidArgumentError),
  );
});
