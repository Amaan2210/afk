import { EventEmitter } from "node:events";
import { InvalidArgumentError } from "commander";
import type { Mock } from "vitest";
import { parsePort, runDaemon, type DaemonCommandDeps } from "../../src/cli/daemon-cmd.js";
import type { Daemon, DaemonOptions } from "../../src/daemon/index.js";
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
      onStopRequested: expect.any(Function),
      stopWhenIdle: false,
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

describe("runDaemon stop requests", () => {
  /** The `onStopRequested` the command handed the daemon. */
  const stopRequested = (): ((reason: string) => void) => {
    const given = start.mock.calls[0]?.[0].onStopRequested;
    if (given === undefined) throw new Error("no onStopRequested was given");
    return given;
  };

  it("a stop the daemon asks for stops it cleanly, then exits 0", async () => {
    await runDaemon({}, deps);
    stopRequested()("stop asked by the CLI");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(daemon.stop).toHaveBeenCalledTimes(1);
    expect(daemon.log.info).toHaveBeenCalledWith(
      { reason: "stop asked by the CLI" },
      "daemon stopping",
    );
  });

  it("a second request while it stops does not exit 1 mid-way", async () => {
    daemon.stop.mockReturnValue(new Promise<void>(() => undefined));
    await runDaemon({}, deps);
    stopRequested()("idle");
    stopRequested()("idle");
    expect(proc.exit).not.toHaveBeenCalled();
    expect(daemon.stop).toHaveBeenCalledTimes(1);
  });

  it("--background asks the daemon to stop itself when idle; without it, it does not", async () => {
    await runDaemon({ background: true }, deps);
    expect(start.mock.calls[0]?.[0].stopWhenIdle).toBe(true);
    await runDaemon({}, deps);
    expect(start.mock.calls[1]?.[0].stopWhenIdle).toBe(false);
  });
});
