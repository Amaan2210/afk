import type { IPty } from "node-pty";
import { adaptNodePty } from "../../../src/daemon/sessions/pty.js";

/** Stands in for a node-pty `IPty`, including the Windows internals the adapter releases on exit. */
function fakeNodePty(opts: { resizeError?: Error; internals?: boolean } = {}) {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(e: { exitCode: number }) => void>();
  const subscribe =
    <T>(set: Set<T>) =>
    (cb: T) => {
      set.add(cb);
      return { dispose: () => void set.delete(cb) };
    };
  const agent = { _inSocket: { destroy: vi.fn() }, _conoutSocketWorker: { dispose: vi.fn() } };
  const pty = {
    pid: 42,
    onData: subscribe(dataListeners),
    onExit: subscribe(exitListeners),
    write: vi.fn(),
    resize: vi.fn(() => {
      if (opts.resizeError) throw opts.resizeError;
    }),
    kill: vi.fn(),
    ...(opts.internals === false ? {} : { _agent: agent }),
  };
  return {
    pty,
    agent,
    asIPty: pty as unknown as IPty,
    emitData: (data: string) => [...dataListeners].forEach((cb) => cb(data)),
    emitExit: (exitCode: number) => [...exitListeners].forEach((cb) => cb({ exitCode })),
    listenerCount: () => dataListeners.size + exitListeners.size,
  };
}

describe("adaptNodePty", () => {
  it("passes pid, input and kill through and delivers output as UTF-8 Buffers", () => {
    const fake = fakeNodePty();
    const pty = adaptNodePty(fake.asIPty, "win32");
    const got: Buffer[] = [];
    pty.onData((chunk) => got.push(chunk));
    fake.emitData("é");
    pty.write(Buffer.from("ls\r"));
    pty.kill();
    expect(pty.pid).toBe(42);
    expect(got).toEqual([Buffer.from("é", "utf8")]);
    expect(fake.pty.write).toHaveBeenCalledWith(Buffer.from("ls\r"));
    expect(fake.pty.kill).toHaveBeenCalledTimes(1);
  });

  it("ignores the error node-pty's resize throws once the process has exited", () => {
    const fake = fakeNodePty({
      resizeError: new Error("Cannot resize a pty that has already exited"),
    });
    const pty = adaptNodePty(fake.asIPty, "win32");
    expect(() => pty.resize(100, 30)).not.toThrow();
    expect(fake.pty.resize).toHaveBeenCalledWith(100, 30);
  });

  it("rethrows any other resize error", () => {
    const fake = fakeNodePty({
      resizeError: new Error("resizing must be done using positive cols and rows"),
    });
    const pty = adaptNodePty(fake.asIPty, "win32");
    expect(() => pty.resize(0, 30)).toThrow("positive cols and rows");
  });

  it("on exit releases the input pipe and output worker node-pty leaves open, and unsubscribes", () => {
    const fake = fakeNodePty();
    const pty = adaptNodePty(fake.asIPty, "win32");
    const exits: number[] = [];
    pty.onData(() => {});
    pty.onExit(({ exitCode }) => exits.push(exitCode));
    fake.emitExit(3);
    expect(exits).toEqual([3]);
    expect(fake.agent._inSocket.destroy).toHaveBeenCalledTimes(1);
    expect(fake.agent._conoutSocketWorker.dispose).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(0);
  });

  it("does not call node-pty's kill after exit", () => {
    const fake = fakeNodePty();
    const pty = adaptNodePty(fake.asIPty, "win32");
    fake.emitExit(0);
    pty.kill();
    expect(fake.pty.kill).not.toHaveBeenCalled();
  });

  it("leaves node-pty internals alone off Windows", () => {
    const fake = fakeNodePty();
    adaptNodePty(fake.asIPty, "linux");
    fake.emitExit(0);
    expect(fake.agent._inSocket.destroy).not.toHaveBeenCalled();
    expect(fake.agent._conoutSocketWorker.dispose).not.toHaveBeenCalled();
  });

  it("warns once, and still reports exit, when the node-pty internals are missing", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const exits: number[] = [];
      for (const code of [1, 2]) {
        const fake = fakeNodePty({ internals: false });
        adaptNodePty(fake.asIPty, "win32").onExit(({ exitCode }) => exits.push(exitCode));
        fake.emitExit(code);
      }
      expect(exits).toEqual([1, 2]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
