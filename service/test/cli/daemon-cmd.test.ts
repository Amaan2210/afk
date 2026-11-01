import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidArgumentError } from "commander";
import type { Mock } from "vitest";
import { parsePort, runDaemon, type DaemonCommandDeps } from "../../src/cli/daemon-cmd.js";
import { startDaemon, type Daemon, type DaemonOptions } from "../../src/daemon/index.js";
import { VERSION } from "../../src/version.js";

describe("parsePort", () => {
  it.each([
    ["0", 0],
    ["2350", 2350],
    ["65535", 65535],
  ])("accepts %j", (text, port) => expect(parsePort(text)).toBe(port));

  it.each(["65536", "-1", "abc", "", "1.5", " 80", "0x10", "1e3"])("rejects %j", (text) =>
    expect(() => parsePort(text)).toThrow(InvalidArgumentError),
  );
});

class FakeProcess extends EventEmitter {
  exit = vi.fn<(code: number) => void>();
}

interface FakeDaemon extends Daemon {
  stop: Mock<() => Promise<void>>;
  log: Daemon["log"] & { info: Mock; error: Mock };
}

function fakeDaemon(): FakeDaemon {
  return {
    port: 2350,
    addresses: ["100.84.12.9", "127.0.0.1"],
    log: { info: vi.fn(), error: vi.fn() } as unknown as FakeDaemon["log"],
    stop: vi.fn(async () => undefined),
  };
}

let proc: FakeProcess;
let daemon: FakeDaemon;
let lines: string[];
let start: Mock<(opts: DaemonOptions) => Promise<Daemon>>;
let deps: DaemonCommandDeps;

beforeEach(() => {
  proc = new FakeProcess();
  daemon = fakeDaemon();
  lines = [];
  start = vi.fn(async () => daemon);
  deps = { start, proc, print: (line) => lines.push(line) };
});

describe("runDaemon", () => {
  it("starts with the options given and prints where it listens and why not more", async () => {
    daemon.warning = "No Tailscale address found";
    await runDaemon({ port: 4000, verbose: true }, deps);
    expect(start).toHaveBeenCalledWith({
      port: 4000,
      verbose: true,
      print: deps.print,
      signal: expect.any(AbortSignal),
    });
    expect(lines).toEqual([
      `afk daemon ${VERSION} listening on 100.84.12.9:2350, 127.0.0.1:2350`,
      "warning: No Tailscale address found",
    ]);
  });

  it("logs a stray exception or rejection and keeps running", async () => {
    await runDaemon({}, deps);
    proc.emit("uncaughtException", new Error("boom"));
    proc.emit("unhandledRejection", "nope");
    expect(daemon.log.error).toHaveBeenCalledWith({ err: expect.any(Error) }, "uncaught exception");
    expect(daemon.log.error).toHaveBeenCalledWith({ err: "nope" }, "unhandled rejection");
    expect(proc.exit).not.toHaveBeenCalled();
    expect(daemon.stop).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGBREAK", "SIGTERM", "SIGHUP"])(
    "%s stops the daemon, then exits 0",
    async (s) => {
      await runDaemon({}, deps);
      proc.emit(s);
      await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
      expect(daemon.stop).toHaveBeenCalledTimes(1);
    },
  );

  it("a second signal while the daemon stops exits 1 at once", async () => {
    daemon.stop.mockReturnValue(new Promise<void>(() => undefined));
    await runDaemon({}, deps);
    proc.emit("SIGINT");
    expect(proc.exit).not.toHaveBeenCalled();
    proc.emit("SIGINT");
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(daemon.stop).toHaveBeenCalledTimes(1);
  });

  it("a signal while the daemon starts stops it as soon as it has started", async () => {
    let started!: (d: Daemon) => void;
    start.mockReturnValue(new Promise<Daemon>((resolve) => (started = resolve)));
    const run = runDaemon({}, deps);
    proc.emit("SIGINT");
    expect(daemon.stop).not.toHaveBeenCalled();

    started(daemon);
    await run;
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(daemon.stop).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([]);
  });

  it("a second signal while the daemon starts exits 1 at once", async () => {
    start.mockReturnValue(new Promise<Daemon>(() => undefined));
    void runDaemon({}, deps);
    proc.emit("SIGINT");
    proc.emit("SIGBREAK");
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("a signal while the daemon starts cancels the start, which then exits 0", async () => {
    start.mockImplementation(
      (opts) =>
        new Promise<Daemon>((_resolve, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted")),
          ),
        ),
    );
    const run = runDaemon({}, deps);
    proc.emit("SIGINT");
    await expect(run).resolves.toBeUndefined();
    expect(proc.exit).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("a failed start that nobody asked to stop still fails", async () => {
    start.mockRejectedValue(new Error("already running (pid 7)"));
    await expect(runDaemon({}, deps)).rejects.toThrow("already running");
    expect(proc.exit).not.toHaveBeenCalled();
  });
});

describe("runDaemon --exit-with-parent", () => {
  let alive: boolean;
  let parentAlive: Mock<() => boolean>;

  beforeEach(() => {
    alive = true;
    parentAlive = vi.fn(() => alive);
    deps = { ...deps, parentAlive, parentPollMs: 5 };
  });

  const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 30));

  it("stops the daemon cleanly once the parent process is gone, then exits 0", async () => {
    await runDaemon({ exitWithParent: true }, deps);
    await settle();
    expect(parentAlive).toHaveBeenCalled();
    expect(daemon.stop).not.toHaveBeenCalled();

    alive = false;
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(daemon.stop).toHaveBeenCalledTimes(1);
    expect(daemon.log.info).toHaveBeenCalledWith({ reason: "parent exited" }, "daemon stopping");
    // The watch ends with the stop.
    const checks = parentAlive.mock.calls.length;
    await settle();
    expect(parentAlive).toHaveBeenCalledTimes(checks);
  });

  it("does not watch the parent without the flag", async () => {
    await runDaemon({}, deps);
    await settle();
    expect(parentAlive).not.toHaveBeenCalled();
  });

  it("a signal stop ends the watch", async () => {
    await runDaemon({ exitWithParent: true }, deps);
    proc.emit("SIGINT");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    const checks = parentAlive.mock.calls.length;
    await settle();
    expect(parentAlive).toHaveBeenCalledTimes(checks);
    expect(daemon.stop).toHaveBeenCalledTimes(1);
  });

  it("a parent gone while the daemon starts stops it once started", async () => {
    let started!: (d: Daemon) => void;
    start.mockReturnValue(new Promise<Daemon>((resolve) => (started = resolve)));
    const run = runDaemon({ exitWithParent: true }, deps);
    alive = false;
    await settle();
    expect(proc.exit).not.toHaveBeenCalled();

    started(daemon);
    await run;
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(daemon.stop).toHaveBeenCalledTimes(1);
  });

  it("a failed start ends the watch", async () => {
    start.mockRejectedValue(new Error("already running (pid 7)"));
    await expect(runDaemon({ exitWithParent: true }, deps)).rejects.toThrow("already running");
    const checks = parentAlive.mock.calls.length;
    await settle();
    expect(parentAlive).toHaveBeenCalledTimes(checks);
  });

  it("a parent gone after a stop was asked for does not exit 1 mid-start", async () => {
    let started!: (d: Daemon) => void;
    start.mockReturnValue(new Promise<Daemon>((resolve) => (started = resolve)));
    const run = runDaemon({ exitWithParent: true }, deps);
    proc.emit("SIGINT");
    alive = false;
    await settle();
    expect(proc.exit).not.toHaveBeenCalled();

    started(daemon);
    await run;
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(proc.exit).toHaveBeenCalledTimes(1);
    expect(daemon.stop).toHaveBeenCalledTimes(1);
  });

  it("a parent gone during the Tailscale wait ends a real start at once, exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afk-daemon-cmd-"));
    try {
      const config = { bind: "tailscale", shell: "powershell.exe" };
      await writeFile(join(dir, "config.json"), JSON.stringify(config));
      const tailscale = { interfaces: () => ({}), startWaitMs: 60_000, startPollMs: 60_000 };
      deps = { ...deps, start: (o) => startDaemon({ ...o, configDir: dir, port: 0, tailscale }) };
      const run = runDaemon({ exitWithParent: true }, deps);
      await vi.waitFor(() => expect(lines).toEqual(["waiting for Tailscale…"]), { timeout: 5000 });

      const goneAt = Date.now();
      alive = false;
      await expect(run).resolves.toBeUndefined();
      // Well inside the 60 s wait: the start gave up instead of waiting it out.
      expect(Date.now() - goneAt).toBeLessThan(2000);
      expect(proc.exit).toHaveBeenCalledTimes(1);
      expect(proc.exit).toHaveBeenCalledWith(0);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
