import { attach } from "../../src/cli/attach.js";
import { CliError } from "../../src/cli/run.js";
import { b64, FakeClient, fakeTerminal, session } from "../helpers/fake-attach.js";

const CLEAR = "\x1b[H\x1b[2J";
const CHORD = [0x1d, 0x64];
const DETACHED = "[afk] detached, session proj keeps running · afk attach proj";
/** The message starts a line and clears what the session drew below the cursor (a TUI's footer). */
const NEW_LINE = "\r\n\x1b[J";

function setup(screen = "PS C:\\proj> ", s = session()) {
  const client = new FakeClient();
  client.sessionList = [s];
  client.actLikeDaemon(s, screen);
  const term = fakeTerminal({ columns: 100, rows: 40 });
  return { client, term };
}

/** Waits until the subscribe went out, i.e. attach is listening. */
async function subscribed(client: FakeClient): Promise<void> {
  await vi.waitFor(() => expect(client.ofType("pty.subscribe")).toHaveLength(1));
}

function data(text: string | Buffer, sessionId = "s_1") {
  return { type: "pty.data", sessionId, data: b64(text) };
}

function inputs(client: FakeClient): string[] {
  return client.ofType("pty.input").map((m) => Buffer.from(String(m.data), "base64").toString());
}

describe("attach", () => {
  it("subscribes at the window's size and writes the snapshot over a cleared screen", async () => {
    const { client, term } = setup("PS C:\\proj> ");
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    expect(client.ofType("pty.subscribe")[0]).toMatchObject({
      sessionId: "s_1",
      cols: 100,
      rows: 40,
    });
    expect(term.text()).toBe(`${CLEAR}PS C:\\proj> `);
    expect(term.stdin.setRawMode).toHaveBeenCalledWith(true);
    term.type(CHORD);
    await done;
  });

  it("writes the session's output as raw bytes, so a character split across frames stays whole", async () => {
    const { client, term } = setup("");
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    const text = Buffer.from("é ✓ 日本", "utf8");
    client.push(data(text.subarray(0, 1)));
    client.push(data(text.subarray(1, 5)));
    client.push(data(text.subarray(5)));
    expect(term.bytes().subarray(Buffer.byteLength(CLEAR))).toEqual(text);
    term.type(CHORD);
    await done;
  });

  it("keeps the session's win32-input-mode request out of the window", async () => {
    const { client, term } = setup("\x1b[?9001h\x1b[?1004hPS> ");
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    client.push(data("x\x1b[?90"));
    client.push(data("01hy"));
    expect(term.text()).toBe(`${CLEAR}\x1b[?1004hPS> xy`);
    term.type(CHORD);
    await done;
  });

  it("ignores frames for other sessions", async () => {
    const { client, term } = setup("");
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    client.push(data("elsewhere", "s_2"));
    client.push({ type: "session.updated", session: session({ id: "s_2", state: "ended" }) });
    expect(term.text()).toBe(CLEAR);
    term.type(CHORD);
    expect(await done).toBe("detached");
  });

  it("forwards keystrokes as pty.input", async () => {
    const { client, term } = setup();
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    term.type("dir\r");
    term.type([0x03]);
    expect(inputs(client)).toEqual(["dir\r", "\x03"]);
    term.type(CHORD);
    await done;
  });

  it("Ctrl+] d detaches: nothing typed, the terminal restored, the session named", async () => {
    const { client, term } = setup();
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    term.type([0x1d]);
    term.type("d");
    expect(await done).toBe("detached");
    expect(inputs(client)).toEqual([]);
    expect(term.stdin.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(term.stdin.pause).toHaveBeenCalled();
    expect(client.ofType("pty.unsubscribe")).toEqual([
      { type: "pty.unsubscribe", sessionId: "s_1" },
    ]);
    expect(client.listening()).toBe(0);
    expect(term.stdin.listenerCount("data")).toBe(0);
    expect(term.stdout.listenerCount("resize")).toBe(0);
    expect(term.text().endsWith(`${NEW_LINE}${DETACHED}\r\n`)).toBe(true);
  });

  it("names the session by its id when it has no name", async () => {
    const { client, term } = setup("", session({ name: "" }));
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    term.type(CHORD);
    await done;
    expect(term.text()).toContain("[afk] detached, session s_1 keeps running · afk attach s_1");
  });

  it("uses the latest name the daemon announced", async () => {
    const { client, term } = setup();
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    client.push({ type: "session.updated", session: session({ name: "renamed" }) });
    term.type(CHORD);
    await done;
    expect(term.text()).toContain("session renamed keeps running · afk attach renamed");
  });

  it("returns ended with the exit code when the session ends", async () => {
    const { client, term } = setup();
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    client.push(data("bye\r\n"));
    client.push({ type: "session.updated", session: session({ state: "ended", exitCode: 3 }) });
    expect(await done).toBe("ended");
    expect(term.text()).toContain("bye\r\n");
    expect(term.text().endsWith(`${NEW_LINE}[afk] session ended (exit 3)\r\n`)).toBe(true);
    expect(term.stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(term.stdin.pause).toHaveBeenCalled();
    expect(client.listening()).toBe(0);
  });

  it("shows the last screen of a session that ended before the subscribe, then returns", async () => {
    const { client, term } = setup("last words", session({ state: "ended", exitCode: 0 }));
    expect(await attach(client, "s_1", term.io)).toBe("ended");
    expect(term.text()).toContain(`${CLEAR}last words`);
    expect(term.text()).toContain("[afk] session ended (exit 0)");
  });

  it("treats a removed session as ended", async () => {
    const { client, term } = setup();
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    client.push({ type: "session.removed", sessionId: "s_1" });
    expect(await done).toBe("ended");
    expect(term.text()).toContain("[afk] session ended");
  });

  it("says the connection was lost when the socket closes, and restores the terminal", async () => {
    const { client, term } = setup();
    const done = attach(client, "s_1", term.io);
    await subscribed(client);
    client.dropConnection();
    expect(await done).toBe("lost");
    expect(term.text().endsWith(`${NEW_LINE}[afk] lost connection to the daemon\r\n`)).toBe(true);
    expect(term.stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(term.stdin.pause).toHaveBeenCalled();
    expect(client.listening()).toBe(0);
  });

  it("restores the terminal and rejects when the subscribe fails", async () => {
    const { client, term } = setup();
    client.onRequest = () => ({ error: new Error("no session s_1") });
    await expect(attach(client, "s_1", term.io)).rejects.toThrow("no session s_1");
    expect(term.stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(term.stdin.pause).toHaveBeenCalled();
    expect(client.listening()).toBe(0);
    expect(term.stdin.listenerCount("data")).toBe(0);
  });

  it("stops listening and rejects when raw mode cannot be set", async () => {
    const { client, term } = setup();
    term.stdin.setRawMode.mockImplementationOnce(() => {
      throw new Error("EIO");
    });
    await expect(attach(client, "s_1", term.io)).rejects.toThrow("EIO");
    expect(client.listening()).toBe(0);
    expect(term.stdin.listenerCount("data")).toBe(0);
    expect(client.ofType("pty.subscribe")).toEqual([]);
  });

  it("refuses without a terminal and sends nothing", async () => {
    const client = new FakeClient();
    const term = fakeTerminal({ isTTY: false });
    await expect(attach(client, "s_1", term.io)).rejects.toBeInstanceOf(CliError);
    await expect(attach(client, "s_1", term.io)).rejects.toThrow(/terminal/);
    expect(client.sent).toEqual([]);
    expect(term.stdin.setRawMode).not.toHaveBeenCalled();
  });

  describe("terminal size", () => {
    it("sends pty.resize when the window changes size", async () => {
      const { client, term } = setup();
      const done = attach(client, "s_1", term.io);
      await subscribed(client);
      term.resize(120, 50);
      expect(client.ofType("pty.resize")).toEqual([
        { type: "pty.resize", sessionId: "s_1", cols: 120, rows: 50 },
      ]);
      term.type(CHORD);
      await done;
    });

    it("leaves another client's size alone until this window types, then takes it back", async () => {
      const { client, term } = setup();
      const done = attach(client, "s_1", term.io);
      await subscribed(client);
      client.push({ type: "pty.resized", sessionId: "s_1", cols: 50, rows: 20 });
      expect(client.ofType("pty.resize")).toEqual([]);
      term.type("x");
      term.type("y");
      const order = client.sent.filter((m) => m.type === "pty.resize" || m.type === "pty.input");
      expect(order.map((m) => m.type)).toEqual(["pty.resize", "pty.input", "pty.input"]);
      expect(order[0]).toEqual({ type: "pty.resize", sessionId: "s_1", cols: 100, rows: 40 });
      term.type(CHORD);
      await done;
    });

    it("sends no resize before typing while the size is this window's", async () => {
      const { client, term } = setup();
      const done = attach(client, "s_1", term.io);
      await subscribed(client);
      term.type("x");
      expect(client.ofType("pty.resize")).toEqual([]);
      term.type(CHORD);
      await done;
    });
  });

  describe("terminal modes on the way out", () => {
    it("shows the cursor and turns off mouse, focus and bracketed-paste reporting", async () => {
      const { client, term } = setup();
      const done = attach(client, "s_1", term.io);
      await subscribed(client);
      client.push(data("\x1b[?25l\x1b[?2004h\x1b[?1004h\x1b[?1003h"));
      term.type(CHORD);
      await done;
      const tail = term.text().slice(term.text().lastIndexOf("\x1b[?2004h") + 8);
      for (const mode of ["\x1b[?25h", "\x1b[?2004l", "\x1b[?1004l", "\x1b[?1003l", "\x1b[0m"]) {
        expect(tail).toContain(mode);
      }
    });

    it("leaves the alternate screen only when the session's output entered it", async () => {
      const inAlt = setup();
      let done = attach(inAlt.client, "s_1", inAlt.term.io);
      await subscribed(inAlt.client);
      inAlt.client.push(data("\x1b[?10"));
      inAlt.client.push(data("49h full-screen app"));
      inAlt.term.type(CHORD);
      await done;
      const out = inAlt.term.text();
      expect(out.indexOf("\x1b[?1049l")).toBeGreaterThan(out.indexOf("full-screen app"));
      expect(out.indexOf("\x1b[?1049l")).toBeLessThan(out.indexOf("[afk] detached"));

      const leftAlt = setup();
      done = attach(leftAlt.client, "s_1", leftAlt.term.io);
      await subscribed(leftAlt.client);
      leftAlt.client.push(data("\x1b[?1049hvim\x1b[?1049l"));
      leftAlt.term.type(CHORD);
      await done;
      expect(leftAlt.term.text().split("\x1b[?1049l")).toHaveLength(2);
    });

    it("sees the alternate screen in the snapshot too", async () => {
      const { client, term } = setup("main\r\n\x1b[?1049h\x1b[Halt");
      const done = attach(client, "s_1", term.io);
      await subscribed(client);
      term.type(CHORD);
      await done;
      expect(term.text()).toContain("\x1b[?1049l");
    });
  });
});
