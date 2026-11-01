import { Command, CommanderError } from "commander";
import { launch, registerLaunchCommands, type LaunchOptions } from "../../src/cli/launch.js";
import { CliError } from "../../src/cli/run.js";
import type { SessionKind } from "../../src/protocol/index.js";
import { FakeClient, fakeTerminal, session } from "../helpers/fake-attach.js";

const CHORD = [0x1d, 0x64];

function setup(created = session({ id: "s_7", name: "proj" })) {
  const client = new FakeClient();
  client.actLikeDaemon(created, "");
  const term = fakeTerminal({ columns: 90, rows: 33 });
  return { client, term, io: { cwd: "C:\\proj", client, ...term.io } };
}

async function attached(client: FakeClient): Promise<void> {
  await vi.waitFor(() => expect(client.ofType("pty.subscribe")).toHaveLength(1));
}

describe("launch", () => {
  it("launch creates the session from cwd with pass-through args and attaches", async () => {
    const { client, term, io } = setup();
    const code = launch("claude", ["--dangerously-skip-permissions"], io);
    await attached(client);
    expect(client.sent.map((m) => m.type)).toEqual(["session.create", "pty.subscribe"]);
    expect(client.sent[0]).toEqual({
      type: "session.create",
      cwd: "C:\\proj",
      kind: "claude",
      args: ["--dangerously-skip-permissions"],
    });
    expect(client.sent[1]).toEqual({ type: "pty.subscribe", sessionId: "s_7", cols: 90, rows: 33 });
    term.type(CHORD);
    expect(await code).toBe(0);
  });

  it("passes --name to session.create", async () => {
    const { client, term, io } = setup();
    const code = launch("shell", [], { ...io, name: "scratch" });
    await attached(client);
    expect(client.sent[0]).toEqual({
      type: "session.create",
      cwd: "C:\\proj",
      kind: "shell",
      args: [],
      name: "scratch",
    });
    term.type(CHORD);
    await code;
  });

  it("names the session from the update that arrived before the create ack", async () => {
    const { client, term, io } = setup(session({ id: "s_7", name: "remote-dev" }));
    const code = launch("codex", [], io);
    await attached(client);
    term.type(CHORD);
    expect(await code).toBe(0);
    expect(term.text()).toContain(
      "[afk] detached, session remote-dev keeps running · afk attach remote-dev",
    );
  });

  it("returns the session's exit code when it ends", async () => {
    const { client, term, io } = setup();
    const code = launch("shell", [], io);
    await attached(client);
    client.push({
      type: "session.updated",
      session: session({ id: "s_7", name: "proj", state: "ended", exitCode: 5 }),
    });
    expect(await code).toBe(5);
    expect(term.text()).toContain("[afk] session ended (exit 5)");
    expect(client.listening()).toBe(0);
  });

  it("returns 0 when the session ends with no exit code", async () => {
    const { client, io } = setup();
    const code = launch("shell", [], io);
    await attached(client);
    client.push({ type: "session.removed", sessionId: "s_7" });
    expect(await code).toBe(0);
  });

  it("returns 1 when the connection is lost", async () => {
    const { client, io } = setup();
    const code = launch("shell", [], io);
    await attached(client);
    client.dropConnection();
    expect(await code).toBe(1);
  });

  it("refuses without a terminal before creating a session", async () => {
    const client = new FakeClient();
    const term = fakeTerminal({ isTTY: false });
    await expect(launch("claude", [], { cwd: "C:\\proj", client, ...term.io })).rejects.toThrow(
      CliError,
    );
    expect(client.sent).toEqual([]);
  });

  it("stops listening when session.create fails", async () => {
    const { client, io } = setup();
    client.onRequest = () => ({ error: new Error("C:\\nope is not a folder") });
    await expect(launch("shell", [], io)).rejects.toThrow("not a folder");
    expect(client.listening()).toBe(0);
  });
});

describe("registerLaunchCommands", () => {
  function program() {
    const calls: { kind: SessionKind; args: string[]; opts: LaunchOptions }[] = [];
    const p = new Command("afk")
      .enablePositionalOptions()
      .exitOverride()
      .configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    registerLaunchCommands(p, async (kind, args, opts) => void calls.push({ kind, args, opts }));
    const parse = (...argv: string[]) => p.parseAsync(argv, { from: "user" });
    return { calls, parse };
  }

  it("passes the agent's flags through untouched", async () => {
    const { calls, parse } = program();
    await parse("claude", "--dangerously-skip-permissions", "-p", "hi there", "--model=opus");
    expect(calls).toEqual([
      {
        kind: "claude",
        args: ["--dangerously-skip-permissions", "-p", "hi there", "--model=opus"],
        opts: {},
      },
    ]);
  });

  it("reads --name and --port before the agent's args, and passes them through after", async () => {
    const { calls, parse } = program();
    await parse("codex", "--name", "fix", "--port", "23998", "--resume", "--name", "x");
    expect(calls).toEqual([
      { kind: "codex", args: ["--resume", "--name", "x"], opts: { name: "fix", port: 23998 } },
    ]);
  });

  it("passes -h through after --", async () => {
    const { calls, parse } = program();
    await parse("claude", "--", "--help");
    expect(calls[0]?.args).toEqual(["--help"]);
  });

  it("starts a shell, which takes no args", async () => {
    const { calls, parse } = program();
    await parse("shell", "--name", "scratch");
    expect(calls).toEqual([{ kind: "shell", args: [], opts: { name: "scratch" } }]);
    await expect(parse("shell", "extra")).rejects.toBeInstanceOf(CommanderError);
    expect(calls).toHaveLength(1);
  });

  it("rejects a bad --port", async () => {
    const { parse } = program();
    await expect(parse("claude", "--port", "0")).rejects.toBeInstanceOf(CommanderError);
  });
});
