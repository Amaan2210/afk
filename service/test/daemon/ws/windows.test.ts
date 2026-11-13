import {
  windowArgs,
  windowCmdArgs,
  openSessionWindow,
  type WindowChild,
} from "../../../src/daemon/sessions/window.js";
import pino from "pino";
import { PIXEL_TOKEN, startHarness, type Harness } from "./harness.js";

let h: Harness;
let opened: string[];

beforeEach(async () => {
  opened = [];
  h = await startHarness({ openWindow: (sessionId) => opened.push(sessionId) });
});

afterEach(async () => {
  await h.stop();
});

const subscribe = (sessionId: string) => ({ type: "pty.subscribe", sessionId, cols: 80, rows: 24 });

describe("a session and its laptop window", () => {
  it("a session the phone starts gets a window; one the CLI starts attaches its own", async () => {
    const phone = await h.client(PIXEL_TOKEN);
    const created = await phone.request({
      type: "session.create",
      cwd: h.dir,
      kind: "shell",
      args: [],
    });
    expect(created).toMatchObject({ type: "ack" });
    expect(opened).toEqual([(created as { sessionId?: string }).sessionId]);

    const cli = await h.client();
    expect(
      await cli.request({ type: "session.create", cwd: h.dir, kind: "shell", args: [] }),
    ).toMatchObject({ type: "ack" });
    expect(opened).toHaveLength(1);
  });

  it("ends when its only laptop window closes", async () => {
    const { session, pty } = await h.session();
    const window = await h.client();
    expect(await window.request(subscribe(session.id))).toMatchObject({ type: "ack" });
    window.terminate();
    await vi.waitFor(() => expect(pty.killed).toBe(true));
  });

  it("keeps running while another laptop window shows it", async () => {
    const { session, pty } = await h.session();
    const first = await h.client();
    const second = await h.client();
    await first.request(subscribe(session.id));
    await second.request(subscribe(session.id));
    first.terminate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pty.killed).toBe(false);
    second.terminate();
    await vi.waitFor(() => expect(pty.killed).toBe(true));
  });

  it("keeps running when the phone watching it drops off", async () => {
    const { session, pty } = await h.session();
    const phone = await h.client(PIXEL_TOKEN);
    await phone.request(subscribe(session.id));
    phone.terminate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pty.killed).toBe(false);
  });
});

describe("openSessionWindow", () => {
  const log = pino({ level: "silent" });

  it("starts `afk attach <id> --own-window` on the daemon's port, through cmd's start", () => {
    const calls: [string, string[]][] = [];
    const unref = vi.fn();
    openSessionWindow("s_9", 2350, log, {
      platform: "win32",
      spawnWindow: (file, args) => {
        calls.push([file, args]);
        return { once: () => undefined, unref };
      },
    });
    expect(calls).toEqual([
      [process.env.ComSpec ?? "cmd.exe", windowCmdArgs(process.execPath, "s_9", 2350)],
    ]);
    expect(windowArgs("s_9", 2350).slice(1)).toEqual([
      "attach",
      "s_9",
      "--port",
      "2350",
      "--own-window",
    ]);
    expect(unref).toHaveBeenCalledOnce();
  });

  it("quotes every part of cmd's line after start, so paths with spaces stay whole", () => {
    const args = windowCmdArgs("C:\\Program Files\\nodejs\\node.exe", "s_9", 2350);
    const entry = windowArgs("s_9", 2350)[0];
    expect(args).toEqual([
      "/d",
      "/s",
      "/c",
      `"start "AFK" "C:\\Program Files\\nodejs\\node.exe" "${entry}" "attach" "s_9" "--port" "2350" "--own-window""`,
    ]);
  });

  it("logs a cmd that ends with an error code", () => {
    const warn = vi.spyOn(log, "warn");
    let onExit: ((code: number | null) => void) | undefined;
    openSessionWindow("s_9", 2350, log, {
      platform: "win32",
      spawnWindow: () =>
        ({
          once: (event: string, cb: (code: number | null) => void) => {
            if (event === "exit") onExit = cb;
            return undefined;
          },
          unref: () => undefined,
        }) as unknown as WindowChild,
    });
    onExit?.(0);
    expect(warn).not.toHaveBeenCalled();
    onExit?.(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("opens nothing off Windows, and never throws when the spawn does", () => {
    const spawnWindow = vi.fn(() => {
      throw new Error("ENOENT");
    });
    openSessionWindow("s_9", 2350, log, { platform: "linux", spawnWindow });
    expect(spawnWindow).not.toHaveBeenCalled();
    expect(() =>
      openSessionWindow("s_9", 2350, log, { platform: "win32", spawnWindow }),
    ).not.toThrow();
  });
});

describe("laptop stats", () => {
  it("are sampled only while a phone is connected", async () => {
    const start = vi.spyOn(h.stats, "start");
    const stop = vi.spyOn(h.stats, "stop");
    const cli = await h.client();
    expect(start).not.toHaveBeenCalled();

    const phone = await h.client(PIXEL_TOKEN);
    expect(start).toHaveBeenCalledOnce();
    stop.mockClear();
    phone.terminate();
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    expect(cli.isOpen).toBe(true);
  });
});
