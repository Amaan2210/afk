import {
  SessionProcess,
  type SessionProcessOptions,
} from "../../../src/daemon/sessions/session-process.js";
import { createFakePty } from "../../helpers/fake-pty.js";

function start(over: Partial<SessionProcessOptions> = {}) {
  const fakes = createFakePty();
  const p = new SessionProcess({
    exe: "powershell.exe",
    args: ["-NoLogo"],
    cwd: "D:\\Naya Repos\\p",
    env: { AFK_SESSION_ID: "s_test" },
    cols: 80,
    rows: 24,
    ptyFactory: fakes.factory,
    ringBufferBytes: 1024,
    snapshotScrollback: 100,
    ...over,
  });
  return { p, fake: fakes.last };
}

/** The headless terminal parses writes on a timer; this waits until it has caught up. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("SessionProcess", () => {
  it("spawns through the factory with the session's options", () => {
    const { p, fake } = start();
    expect(fake.lastSpawn).toEqual({
      exe: "powershell.exe",
      args: ["-NoLogo"],
      cwd: "D:\\Naya Repos\\p",
      env: { AFK_SESSION_ID: "s_test" },
      cols: 80,
      rows: 24,
    });
    expect(p.pid).toBe(fake.pid);
    expect({ cols: p.cols, rows: p.rows }).toEqual({ cols: 80, rows: 24 });
  });

  it("forwards written bytes to the pty", () => {
    const { p, fake } = start();
    p.write(Buffer.from("ls\r"));
    expect(fake.written[0]).toEqual(Buffer.from("ls\r"));
  });

  it("emits raw chunks and keeps multi-byte characters intact across chunk boundaries", async () => {
    const { p, fake } = start();
    const got: Buffer[] = [];
    p.onData((chunk) => got.push(chunk));
    fake.emitData(Buffer.from([0xc3]));
    fake.emitData(Buffer.from([0xa9]));
    expect(got).toEqual([Buffer.from([0xc3]), Buffer.from([0xa9])]);
    expect(Buffer.concat(got).toString("utf8")).toBe("é");
    await settle();
    const screen = p.snapshot().data.toString("utf8");
    expect(screen).toContain("é");
    expect(screen).not.toContain("\uFFFD");
  });

  it("snapshot contains text written to the terminal", () => {
    const { p, fake } = start();
    fake.emitData("hello\r\n");
    expect(p.snapshot().data.toString()).toContain("hello");
  });

  it("snapshot keeps scrollback up to snapshotScrollback lines", async () => {
    const { p, fake } = start({ rows: 5, snapshotScrollback: 10 });
    for (let i = 0; i < 30; i++) fake.emitData(`line-${String(i).padStart(2, "0")}\r\n`);
    await settle();
    const screen = p.snapshot().data.toString();
    expect(screen).toContain("line-20");
    expect(screen).toContain("line-29");
    expect(screen).not.toContain("line-00");
  });

  it("snapshot reflects the latest resize", () => {
    const { p, fake } = start();
    p.resize(100, 30);
    expect(p.snapshot()).toMatchObject({ cols: 100, rows: 30 });
    expect(fake.size).toEqual({ cols: 100, rows: 30 });
    expect({ cols: p.cols, rows: p.rows }).toEqual({ cols: 100, rows: 30 });
  });

  it("exit propagates the code", () => {
    const { p, fake } = start();
    const codes: number[] = [];
    p.onExit((code) => codes.push(code));
    fake.emitExit(3);
    expect(codes).toEqual([3]);
  });

  it("kill kills the pty", () => {
    const { p, fake } = start();
    p.kill();
    expect(fake.killed).toBe(true);
  });

  it("onData and onExit return unsubscribe functions", () => {
    const { p, fake } = start();
    const data = vi.fn();
    const exit = vi.fn();
    p.onData(data)();
    p.onExit(exit)();
    fake.emitData("x");
    fake.emitExit(0);
    expect(data).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("after exit, keeps the last snapshot and ignores write and resize", () => {
    const { p, fake } = start();
    fake.emitData("bye\r\n");
    fake.emitExit(0);
    p.write(Buffer.from("x"));
    p.resize(100, 30);
    expect(fake.written).toEqual([]);
    expect(fake.size).toEqual({ cols: 80, rows: 24 });
    expect(p.snapshot()).toMatchObject({ cols: 80, rows: 24 });
    expect(p.snapshot().data.toString()).toContain("bye");
  });

  it("after exit, still passes kill to the pty, which owns any clean-up", () => {
    const { p, fake } = start();
    fake.emitExit(0);
    p.kill();
    expect(fake.killed).toBe(true);
  });
});
