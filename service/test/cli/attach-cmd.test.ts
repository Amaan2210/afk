import { resolveSession, runAttach, runAttachCommand } from "../../src/cli/attach-cmd.js";
import { CliError, NOT_RUNNING_HINT } from "../../src/cli/run.js";
import { FakeClient, fakeTerminal, noDaemon, session } from "../helpers/fake-attach.js";

const CHORD = [0x1d, 0x64];

describe("resolveSession", () => {
  const live = session({ id: "s_1", name: "api" });
  const other = session({ id: "s_2", name: "web", state: "working" });

  it("finds a session by its exact id", () => {
    expect(resolveSession("s_2", [live, other])).toBe(other);
  });

  it("finds a session by its exact name", () => {
    expect(resolveSession("api", [live, other])).toBe(live);
  });

  it("prefers the id when a name equals another session's id", () => {
    const confusing = session({ id: "s_3", name: "s_1" });
    expect(resolveSession("s_1", [confusing, live])).toBe(live);
  });

  it("matches neither a prefix nor another case", () => {
    expect(() => resolveSession("ap", [live])).toThrow(CliError);
    expect(() => resolveSession("API", [live])).toThrow(CliError);
    expect(() => resolveSession("s_", [live])).toThrow(CliError);
  });

  it("names no match and points at afk ls", () => {
    expect(() => resolveSession("nope", [live])).toThrow(/no session "nope".*afk ls/s);
    expect(() => resolveSession("nope", [])).toThrow(
      expect.objectContaining({ name: "CliError", code: 1 }),
    );
  });

  it("lists every session a shared name matches, with id, name and state", () => {
    const twin = session({ id: "s_9", name: "api", state: "needs_input" });
    let message = "";
    try {
      resolveSession("api", [live, other, twin]);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect(err).toMatchObject({ code: 1 });
      message = (err as Error).message;
    }
    expect(message).toMatch(/"api" names 2 sessions/);
    expect(message).toMatch(/s_1\s+api\s+idle/);
    expect(message).toMatch(/s_9\s+api\s+needs_input/);
    expect(message).not.toContain("s_2");
    expect(message).toContain("afk attach <id>");
  });

  it("refuses an ended session given by id with a clear message", () => {
    const ended = session({ id: "s_4", name: "old", state: "ended", exitCode: 2 });
    expect(() => resolveSession("s_4", [ended])).toThrow(/session old has ended \(exit 2\)/);
    expect(() => resolveSession("s_4", [ended])).toThrow(
      expect.objectContaining({ name: "CliError", code: 1 }),
    );
  });

  it("matches names among live sessions only", () => {
    const ended = session({ id: "s_4", name: "api", state: "ended", exitCode: 0 });
    expect(resolveSession("api", [ended, live])).toBe(live);
  });

  it("says when the only sessions with that name have ended", () => {
    const ended = session({ id: "s_4", name: "old", state: "ended", exitCode: 2 });
    expect(() => resolveSession("old", [ended])).toThrow(
      /no running session "old".*ended.*afk ls/s,
    );
    expect(() => resolveSession("old", [ended])).toThrow(
      expect.objectContaining({ name: "CliError", code: 1 }),
    );
  });
});

describe("runAttach", () => {
  function setup(sessions = [session({ id: "s_1", name: "api" })]) {
    const client = new FakeClient();
    client.sessionList = sessions;
    client.actLikeDaemon(sessions[0], "screen");
    return { client, term: fakeTerminal() };
  }

  it("attaches to the session a name resolves to and exits 0 on detach", async () => {
    const { client, term } = setup();
    const code = runAttach("api", client, term.io);
    await vi.waitFor(() => expect(client.ofType("pty.subscribe")).toHaveLength(1));
    expect(client.ofType("pty.subscribe")[0]).toMatchObject({ sessionId: "s_1" });
    term.type(CHORD);
    expect(await code).toBe(0);
    expect(term.text()).toContain("[afk] detached, session api keeps running · afk attach api");
    expect(client.listening()).toBe(0);
  });

  it("exits with the session's code when it ends while attached", async () => {
    const { client, term } = setup();
    const code = runAttach("s_1", client, term.io);
    await vi.waitFor(() => expect(client.ofType("pty.subscribe")).toHaveLength(1));
    client.push({
      type: "session.updated",
      session: session({ id: "s_1", name: "api", state: "ended", exitCode: 4 }),
    });
    expect(await code).toBe(4);
  });

  it("exits 1 when the connection is lost", async () => {
    const { client, term } = setup();
    const code = runAttach("api", client, term.io);
    await vi.waitFor(() => expect(client.ofType("pty.subscribe")).toHaveLength(1));
    client.dropConnection();
    expect(await code).toBe(1);
  });

  it("resolves against updates newer than the greeting's list", async () => {
    const { client, term } = setup();
    client.sessions = async () => {
      // A rename the daemon announces after its greeting, before the list is read.
      client.push({ type: "session.updated", session: session({ id: "s_1", name: "renamed" }) });
      return [session({ id: "s_1", name: "api" })];
    };
    const code = runAttach("renamed", client, term.io);
    await vi.waitFor(() => expect(client.ofType("pty.subscribe")).toHaveLength(1));
    term.type(CHORD);
    expect(await code).toBe(0);
  });

  it("checks for a terminal before connecting, so no daemon still exits 1 with that reason", async () => {
    const { deps, err } = noDaemon();
    const term = fakeTerminal({ isTTY: false });
    await runAttachCommand("api", {}, term.io, deps);
    expect(deps.setExitCode).toHaveBeenCalledExactlyOnceWith(1);
    expect(err()).toMatch(/^afk: .*interactive terminal/);
    expect(err()).not.toContain(NOT_RUNNING_HINT);
    expect(deps.loadPort).not.toHaveBeenCalled();
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("refuses an unknown session without subscribing", async () => {
    const { client, term } = setup();
    await expect(runAttach("nope", client, term.io)).rejects.toBeInstanceOf(CliError);
    expect(client.sent).toEqual([]);
    expect(term.stdin.setRawMode).not.toHaveBeenCalled();
    expect(client.listening()).toBe(0);
  });
});
