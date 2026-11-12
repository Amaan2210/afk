import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSessionProfile } from "../../../src/daemon/sessions/profile.js";
import { SessionRegistry, type RegistryDeps } from "../../../src/daemon/sessions/registry.js";
import type { AgentSignal, NotifyKind } from "../../../src/daemon/sessions/state.js";
import type { Pending, Session } from "../../../src/protocol/index.js";
import { createFakePty, type FakePty } from "../../helpers/fake-pty.js";

const HOUR = 3_600_000;

let deps: RegistryDeps;
let reg: SessionRegistry;
/** The most recently spawned fake pty. */
let fake: FakePty;
let clock: Date;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

function collect(r: SessionRegistry = reg) {
  const updates: Session[] = [];
  const notes: { kind: NotifyKind; session: Session }[] = [];
  const signals: [string, AgentSignal][] = [];
  const removed: string[] = [];
  const exits: [string, number][] = [];
  r.on("updated", (s) => updates.push(s));
  r.on("notify", (n) => notes.push(n));
  r.on("signal", (id, s) => signals.push([id, s]));
  r.on("removed", (id) => removed.push(id));
  r.on("exit", (id, code) => exits.push([id, code]));
  return { updates, notes, signals, removed, exits };
}

beforeEach(async () => {
  const fakes = createFakePty();
  clock = new Date("2026-10-31T10:00:00.000Z");
  deps = {
    ptyFactory: (o) => (fake = fakes.factory(o) as FakePty),
    shell: {
      exe: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      kind: "powershell",
    },
    sessionsDir: await mkdtemp(join(tmpdir(), "afk-registry-")),
    port: 2350,
    nodeExe: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry: "D:\\My Repos\\afk\\service\\dist\\cli.js",
    ringBufferBytes: 4096,
    snapshotScrollback: 100,
    retentionHours: 24,
    now: () => clock,
    baseEnv: { Path: "C:\\Windows", AFK_SESSION_ID: "stale" },
  };
  reg = new SessionRegistry(deps);
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(deps.sessionsDir, { recursive: true, force: true });
});

describe("SessionRegistry.create", () => {
  it("create spawns the shell with the session profile in cwd and names after the folder", async () => {
    const s = await reg.create({
      cwd: "D:\\My Repos\\web-app",
      kind: "shell",
      args: [],
    });
    expect(s.name).toBe("web-app");
    expect(s.state).toBe("idle");
    expect(s.kind).toBe("shell");
    expect(fake.lastSpawn.args).toEqual([
      "-NoLogo",
      "-NoExit",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(deps.sessionsDir, s.id, "profile.ps1"),
    ]);
    expect(fake.lastSpawn.env.AFK_SESSION_ID).toBe(s.id);
  });

  it("spawns the configured shell in cwd with AFK_* merged over the base environment", async () => {
    const { updates } = collect();
    const s = await reg.create({
      cwd: "D:\\My Repos\\web-app",
      kind: "shell",
      args: [],
    });
    expect(fake.lastSpawn).toMatchObject({
      exe: deps.shell.exe,
      cwd: "D:\\My Repos\\web-app",
      env: { Path: "C:\\Windows", AFK_SESSION_ID: s.id, AFK_PORT: "2350" },
    });
    expect(s).toMatchObject({
      createdAt: clock.toISOString(),
      lastActivityAt: clock.toISOString(),
      subagentsRunning: 0,
    });
    expect(updates).toEqual([s]);
    expect(reg.list()).toEqual([s]);
  });

  it("writes the generated profile, byte order mark included, into the session folder", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const bytes = await readFile(join(deps.sessionsDir, s.id, "profile.ps1"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toBe(
      renderSessionProfile({
        sessionId: s.id,
        port: 2350,
        nodeExe: deps.nodeExe,
        cliEntry: deps.cliEntry,
      }),
    );
  });

  it("create for claude types the launch line after the first output chunk", async () => {
    const s = await reg.create({
      cwd: "D:\\p",
      kind: "claude",
      args: ["--dangerously-skip-permissions"],
      prompt: "Add login",
    });
    fake.emitData("PS D:\\p> ");
    await tick();
    expect(fake.written.map(String)).toContain(
      'claude --dangerously-skip-permissions "Add login"\r',
    );
    expect(s.kind).toBe("claude");
  });

  it("types the launch line once, as one write, however much output follows", async () => {
    await reg.create({ cwd: "D:\\p", kind: "claude", args: ["--add-dir", "D:\\My Repos\\café"] });
    fake.emitData("PS D:\\p> ");
    fake.emitData("more");
    expect(fake.written.map(String)).toEqual(['claude --add-dir "D:\\My Repos\\café"\r']);
  });

  it("types the launch line after 3 s when the shell prints nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await reg.create({ cwd: "D:\\p", kind: "codex", args: [], prompt: "hi" });
    vi.advanceTimersByTime(2999);
    expect(fake.written).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fake.written.map(String)).toEqual(['codex "hi"\r']);
    fake.emitData("PS D:\\p> ");
    expect(fake.written).toHaveLength(1);
  });

  it("never types the launch line into a session that was killed or exited first", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const killed = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    const killedPty = fake;
    reg.kill(killed.id);
    killedPty.emitData("bye");
    await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    fake.emitExit(0);
    vi.advanceTimersByTime(3000);
    expect(killedPty.written).toEqual([]);
    expect(fake.written).toEqual([]);
  });

  it("types nothing into a plain shell", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    fake.emitData("PS D:\\p> ");
    vi.advanceTimersByTime(3000);
    expect(fake.written).toEqual([]);
  });

  it("refuses shell args before spawning or writing anything", async () => {
    await expect(reg.create({ cwd: "D:\\p", kind: "shell", args: ["-x"] })).rejects.toThrow(
      /^bad_request:/,
    );
    expect(await readdir(deps.sessionsDir)).toEqual([]);
    expect(reg.list()).toEqual([]);
  });

  it("defaults to 120x30 and names after the last path segment", async () => {
    await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    expect(fake.lastSpawn).toMatchObject({ cols: 120, rows: 30 });
    const named = await reg.create({
      cwd: "D:\\p",
      kind: "shell",
      args: [],
      name: "mine",
      cols: 80,
      rows: 24,
    });
    expect(named.name).toBe("mine");
    expect(fake.lastSpawn).toMatchObject({ cols: 80, rows: 24 });
    expect((await reg.create({ cwd: "D:\\My Repos\\q\\", kind: "shell", args: [] })).name).toBe(
      "q",
    );
    expect((await reg.create({ cwd: "C:/Users/user/", kind: "shell", args: [] })).name).toBe(
      "user",
    );
    expect((await reg.create({ cwd: "D:\\", kind: "shell", args: [] })).name).toBe("D:");
  });

  it("reads the git branch on create and refreshes it on each signal", async () => {
    const repo = join(deps.sessionsDir, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    const s = await reg.create({ cwd: join(repo, "src"), kind: "shell", args: [] });
    expect(s.gitBranch).toBe("main");

    const { updates } = collect();
    await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/feature\n");
    reg.signal(s.id, { kind: "turn_start" });
    await vi.waitFor(() => expect(reg.get(s.id)!.session.gitBranch).toBe("feature"));
    expect(updates.map((u) => [u.state, u.gitBranch])).toEqual([
      ["working", "main"],
      ["working", "feature"],
    ]);

    reg.signal(s.id, { kind: "turn_start" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates).toHaveLength(2);
  });
});

describe("SessionRegistry lifecycle", () => {
  it("kill ends the session and emits updated with state ended", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    const { updates, exits } = collect();
    reg.kill(s.id);
    expect(fake.killed).toBe(true);
    expect(reg.get(s.id)!.killRequested).toBe(true);
    expect(reg.list()[0].state).toBe("idle");

    advance(1000);
    fake.emitExit(1);
    expect(reg.list()[0]).toMatchObject({
      state: "ended",
      exitCode: 1,
      endedAt: clock.toISOString(),
    });
    expect(updates.at(-1)!.state).toBe("ended");
    expect(exits).toEqual([[s.id, 1]]);

    fake.killed = false;
    reg.kill(s.id);
    expect(fake.killed).toBe(false);
  });

  it("records the exit code the pty reports, -1 when it is not an integer", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const { signals, exits } = collect();
    fake.emitExit(undefined as unknown as number);
    expect(reg.get(s.id)!.killRequested).toBe(false);
    expect(reg.get(s.id)!.session).toMatchObject({ state: "ended", exitCode: -1 });
    expect(signals).toEqual([[s.id, { kind: "process_exit", exitCode: -1 }]]);
    expect(exits).toEqual([[s.id, -1]]);
  });

  it("orders events: signal, updated, notify on a signal; signal, updated, exit on exit", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    const events: string[] = [];
    reg.on("signal", () => events.push("signal"));
    reg.on("updated", () => events.push("updated"));
    reg.on("notify", () => events.push("notify"));
    reg.on("exit", () => events.push("exit"));
    reg.signal(s.id, { kind: "turn_end", lastMessage: "Done" });
    expect(events).toEqual(["signal", "updated", "notify"]);
    events.length = 0;
    fake.emitExit(0);
    expect(events).toEqual(["signal", "updated", "exit"]);
  });

  it("emits every signal it applies, from signal(), input and exit", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    const { signals } = collect();
    reg.signal(s.id, { kind: "turn_start" });
    reg.signal(s.id, { kind: "turn_start" });
    reg.input(s.id, Buffer.from("y"));
    fake.emitExit(0);
    expect(signals).toEqual([
      [s.id, { kind: "turn_start" }],
      [s.id, { kind: "turn_start" }],
      [s.id, { kind: "user_input" }],
      [s.id, { kind: "process_exit", exitCode: 0 }],
    ]);
  });

  it("signal applies the reducer and emits notify", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    const { updates, notes } = collect();
    reg.signal(s.id, { kind: "turn_start" });
    reg.signal(s.id, { kind: "turn_end", lastMessage: "All done" });
    expect(updates.map((u) => u.state)).toEqual(["working", "finished"]);
    expect(updates[1].lastMessage).toBe("All done");
    expect(notes).toEqual([{ kind: "finished", session: updates[1] }]);
    expect(reg.get(s.id)!.session).toMatchObject({ state: "finished", lastMessage: "All done" });
  });

  it("sets and clears a pending question without re-notifying for the same id", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    const { updates, notes, signals } = collect();
    const pending: Pending = {
      kind: "permission",
      id: "perm-1",
      tool: "Bash",
      summary: "npm test",
    };
    reg.signal(s.id, { kind: "pending", pending });
    reg.signal(s.id, { kind: "pending", pending: { ...pending } });
    expect(signals).toHaveLength(2);
    expect(updates.map((u) => u.state)).toEqual(["needs_input"]);
    expect(notes.map((n) => n.kind)).toEqual(["needs_input"]);
    expect(reg.get(s.id)!.session.pending).toEqual(pending);

    reg.signal(s.id, { kind: "pending_cleared", pendingId: "perm-1" });
    expect("pending" in reg.get(s.id)!.session).toBe(false);
    expect(updates).toHaveLength(2);
    expect(updates[1].state).toBe("working");
    expect(updates[1].pending).toBeUndefined();
  });

  it("input writes bytes and moves finished to idle", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    reg.signal(s.id, { kind: "turn_end" });
    const { updates } = collect();
    reg.input(s.id, Buffer.from("x"));
    expect(fake.written.map(String)).toContain("x");
    expect(reg.get(s.id)!.session.state).toBe("idle");
    expect(updates.map((u) => u.state)).toEqual(["idle"]);

    reg.input(s.id, Buffer.from("y"));
    expect(fake.written.map(String)).toContain("y");
    expect(updates).toHaveLength(1);
  });

  it("emits data per chunk but activity updates at most once per 5 s", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const { updates } = collect();
    const data: [string, Buffer][] = [];
    reg.on("data", (id, chunk) => data.push([id, chunk]));

    advance(1000);
    fake.emitData("a");
    expect(updates).toHaveLength(0);
    expect(reg.get(s.id)!.session.lastActivityAt).toBe(clock.toISOString());

    advance(4000);
    fake.emitData("b");
    expect(updates).toHaveLength(1);
    expect(updates[0].lastActivityAt).toBe(clock.toISOString());

    advance(4999);
    fake.emitData("c");
    expect(updates).toHaveLength(1);
    advance(1);
    fake.emitData("d");
    expect(updates).toHaveLength(2);

    reg.signal(s.id, { kind: "turn_start" });
    expect(updates).toHaveLength(3);

    expect(data.map(([id, chunk]) => [id, chunk.toString()])).toEqual(
      ["a", "b", "c", "d"].map((c) => [s.id, c]),
    );
    expect(Buffer.isBuffer(data[0][1])).toBe(true);
  });

  it("setMeta merges meta and the named session fields and emits updated", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const { updates } = collect();
    advance(60_000);
    reg.setMeta(s.id, {
      transcriptPath: "C:\\t.jsonl",
      kind: "claude",
      agentSessionId: "sess-1",
      lastMessage: "hi",
    });
    reg.setMeta(s.id, { rolloutPath: "C:\\r.jsonl" });
    const rec = reg.get(s.id)!;
    expect(rec.meta).toEqual({ transcriptPath: "C:\\t.jsonl", rolloutPath: "C:\\r.jsonl" });
    expect(rec.session).toMatchObject({
      kind: "claude",
      agentSessionId: "sess-1",
      lastMessage: "hi",
      state: "idle",
      lastActivityAt: s.lastActivityAt,
    });
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ kind: "claude", agentSessionId: "sess-1" });
  });

  it("rename changes the name and emits updated", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const { updates } = collect();
    reg.rename(s.id, "auth work");
    expect(reg.get(s.id)!.session.name).toBe("auth work");
    expect(updates.map((u) => u.name)).toEqual(["auth work"]);
  });

  it("hands out copies, so callers cannot change the registry's sessions", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    s.name = "changed";
    reg.list()[0].name = "changed";
    expect(reg.get(s.id)!.session.name).toBe("p");
  });

  it("throws not_found for an unknown session id", async () => {
    const calls = [
      () => reg.kill("s_nope"),
      () => reg.rename("s_nope", "x"),
      () => reg.signal("s_nope", { kind: "turn_start" }),
      () => reg.input("s_nope", Buffer.from("x")),
      () => reg.setMeta("s_nope", { kind: "claude" }),
    ];
    for (const call of calls) expect(call).toThrow(/^not_found:/);
    await expect(reg.resume("s_nope")).rejects.toThrow(/^not_found:/);
    expect(reg.get("s_nope")).toBeUndefined();
  });
});

describe("SessionRegistry names", () => {
  const names = () => reg.list().map((s) => s.name);

  it("gives sessions created in the same folder distinct names, first free suffix", async () => {
    const first = await reg.create({ cwd: "D:\\My Repos\\proj", kind: "shell", args: [] });
    const second = await reg.create({ cwd: "D:\\My Repos\\proj", kind: "claude", args: [] });
    const third = await reg.create({ cwd: "C:\\other\\proj\\", kind: "shell", args: [] });
    expect([first.name, second.name, third.name]).toEqual(["proj", "proj-2", "proj-3"]);
    expect(names()).toEqual(["proj", "proj-2", "proj-3"]);
  });

  it("applies to explicit names too", async () => {
    await reg.create({ cwd: "D:\\a", kind: "shell", args: [], name: "auth work" });
    const again = await reg.create({ cwd: "D:\\b", kind: "shell", args: [], name: "auth work" });
    expect(again.name).toBe("auth work-2");
  });

  it("gives two creates in flight at once distinct names", async () => {
    const [a, b] = await Promise.all([
      reg.create({ cwd: "D:\\proj", kind: "shell", args: [] }),
      reg.create({ cwd: "D:\\proj", kind: "shell", args: [] }),
    ]);
    expect([a.name, b.name].sort()).toEqual(["proj", "proj-2"]);
  });

  it("renames onto a taken name with the first free suffix, and to its own name unchanged", async () => {
    const api = await reg.create({ cwd: "D:\\api", kind: "shell", args: [] });
    await reg.create({ cwd: "D:\\x", kind: "shell", args: [], name: "api-2" });
    const web = await reg.create({ cwd: "D:\\web", kind: "shell", args: [] });
    const { updates } = collect();
    reg.rename(web.id, "api");
    expect(reg.get(web.id)!.session.name).toBe("api-3");
    expect(updates.map((u) => u.name)).toEqual(["api-3"]);
    reg.rename(api.id, "api");
    expect(reg.get(api.id)!.session.name).toBe("api");
  });

  it("lets a name be reused once the session holding it has ended", async () => {
    const first = await reg.create({ cwd: "D:\\proj", kind: "claude", args: [] });
    const firstPty = fake;
    const second = await reg.create({ cwd: "D:\\proj", kind: "shell", args: [] });
    expect(second.name).toBe("proj-2");
    firstPty.emitExit(0);
    expect(reg.get(first.id)!.session).toMatchObject({ name: "proj", state: "ended" });
    expect((await reg.create({ cwd: "D:\\proj", kind: "shell", args: [] })).name).toBe("proj");
    // "proj" and "proj-2" are live again; the ended session's "proj" blocks nothing.
    const other = await reg.create({ cwd: "D:\\other", kind: "shell", args: [] });
    reg.rename(other.id, "proj");
    expect(reg.get(other.id)!.session.name).toBe("proj-3");
  });

  it("a resumed session keeps its name unless a live session took it meanwhile", async () => {
    const src = await reg.create({ cwd: "D:\\proj", kind: "claude", args: [] });
    reg.setMeta(src.id, { agentSessionId: "abc" });
    fake.emitExit(0);
    expect((await reg.resume(src.id)).name).toBe("proj");
    const again = await reg.create({ cwd: "D:\\elsewhere", kind: "claude", args: [], name: "x" });
    reg.setMeta(again.id, { agentSessionId: "def" });
    fake.emitExit(0);
    await reg.create({ cwd: "D:\\y", kind: "shell", args: [], name: "x" });
    expect((await reg.resume(again.id)).name).toBe("x-2");
  });
});

describe("SessionRegistry.resume", () => {
  it("resume creates a new session running claude <original args> --resume <id>", async () => {
    const src = await reg.create({
      cwd: "D:\\My Repos\\p",
      kind: "claude",
      args: ["--dangerously-skip-permissions", "--model", "opus"],
      prompt: "Add login",
      name: "auth work",
    });
    reg.setMeta(src.id, { agentSessionId: "abc" });
    fake.emitExit(0);
    const s = await reg.resume(src.id);
    expect(s.id).not.toBe(src.id);
    expect(s).toMatchObject({
      cwd: "D:\\My Repos\\p",
      kind: "claude",
      name: "auth work",
      state: "idle",
    });
    fake.emitData("PS D:\\My Repos\\p> ");
    expect(fake.written.map(String)).toEqual([
      "claude --dangerously-skip-permissions --model opus --resume abc\r",
    ]);
    expect(reg.list().map((x) => x.id)).toEqual([src.id, s.id]);

    // Resuming the resumed session keeps the original args and does not stack --resume.
    reg.setMeta(s.id, { agentSessionId: "def" });
    fake.emitExit(0);
    await reg.resume(s.id);
    fake.emitData("PS> ");
    expect(fake.written.map(String)).toEqual([
      "claude --dangerously-skip-permissions --model opus --resume def\r",
    ]);
  });

  it("resumes a codex session with codex resume <id>", async () => {
    const src = await reg.create({ cwd: "D:\\p", kind: "codex", args: [] });
    reg.setMeta(src.id, { agentSessionId: "019a-thread" });
    fake.emitExit(0);
    const s = await reg.resume(src.id);
    expect(s.kind).toBe("codex");
    fake.emitData("PS> ");
    expect(fake.written.map(String)).toEqual(["codex resume 019a-thread\r"]);
  });

  it("puts a codex session's original args before the resume subcommand", async () => {
    const src = await reg.create({
      cwd: "D:\\p",
      kind: "codex",
      args: ["--dangerously-bypass-approvals-and-sandbox", "-m", "gpt-5"],
    });
    reg.setMeta(src.id, { agentSessionId: "th-1" });
    fake.emitExit(0);
    await reg.resume(src.id);
    fake.emitData("PS> ");
    expect(fake.written.map(String)).toEqual([
      "codex --dangerously-bypass-approvals-and-sandbox -m gpt-5 resume th-1\r",
    ]);
  });

  it("does not hand one agent's args to another after the session's kind changed", async () => {
    const src = await reg.create({
      cwd: "D:\\p",
      kind: "claude",
      args: ["--dangerously-skip-permissions"],
    });
    reg.setMeta(src.id, { kind: "codex", agentSessionId: "th-2" });
    fake.emitExit(0);
    await reg.resume(src.id);
    fake.emitData("PS> ");
    expect(fake.written.map(String)).toEqual(["codex resume th-2\r"]);
  });

  it("refuses a live session or one without an agent session id", async () => {
    const live = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    reg.setMeta(live.id, { agentSessionId: "abc" });
    await expect(reg.resume(live.id)).rejects.toThrow(/^bad_request:/);

    const anonymous = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    fake.emitExit(0);
    await expect(reg.resume(anonymous.id)).rejects.toThrow(/^bad_request:/);
    expect(reg.list()).toHaveLength(2);
  });
});

describe("SessionRegistry retention", () => {
  /**
   * A pruned session's folder is removed in the background. Waiting for it keeps that removal from
   * racing afterEach's removal of the whole root, which fails with EPERM on Windows.
   */
  const folderGone = (id: string) =>
    vi.waitFor(() => expect(existsSync(join(deps.sessionsDir, id))).toBe(false));

  it("pruneEnded removes ended sessions older than retentionHours", async () => {
    const ended = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const endedPty = fake;
    const live = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    endedPty.emitExit(0);
    const { removed } = collect();

    advance(23 * HOUR);
    reg.pruneEnded();
    expect(removed).toEqual([]);

    advance(2 * HOUR);
    reg.pruneEnded();
    expect(removed).toEqual([ended.id]);
    expect(reg.get(ended.id)).toBeUndefined();
    expect(reg.list().map((s) => s.id)).toEqual([live.id]);
    await folderGone(ended.id);
  });

  it("pruneEnded deletes the pruned session's folder and keeps the others", async () => {
    const ended = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const endedPty = fake;
    const live = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    endedPty.emitExit(0);
    const endedDir = join(deps.sessionsDir, ended.id);
    expect(existsSync(join(endedDir, "profile.ps1"))).toBe(true);

    advance(25 * HOUR);
    reg.pruneEnded();
    await vi.waitFor(() => expect(existsSync(endedDir)).toBe(false));
    expect(existsSync(join(deps.sessionsDir, live.id, "profile.ps1"))).toBe(true);
  });

  it("uses the configured retention", async () => {
    const short = new SessionRegistry({ ...deps, retentionHours: 1 });
    const s = await short.create({ cwd: "D:\\p", kind: "shell", args: [] });
    fake.emitExit(0);
    const { removed } = collect(short);
    advance(HOUR + 1);
    short.pruneEnded();
    expect(removed).toEqual([s.id]);
    await folderGone(s.id);
  });

  it("pruneEnded applies a retention given at call time over the configured one", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    fake.emitExit(0);
    const { removed } = collect();
    advance(2 * HOUR);
    reg.pruneEnded();
    expect(removed).toEqual([]);
    reg.pruneEnded(1);
    expect(removed).toEqual([s.id]);
    await folderGone(s.id);
  });

  it("stopAll kills every live session", async () => {
    const a = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const aPty = fake;
    const b = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    const bPty = fake;
    const c = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    fake.emitExit(0);
    reg.stopAll();
    expect([aPty.killed, bPty.killed, fake.killed]).toEqual([true, true, false]);
    expect([a, b, c].map((s) => reg.get(s.id)!.killRequested)).toEqual([true, true, false]);
  });
});

describe("a session and the agent it was started for", () => {
  it("ends with its agent: the shell is told to exit once the agent has quit", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    fake.emitData("PS> ");
    fake.written.length = 0;
    reg.signal(s.id, { kind: "agent_exit" });
    expect(fake.written.map(String)).toEqual(["exit\r"]);
  });

  it("a shell session keeps running when an agent typed into it quits", async () => {
    const s = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    fake.emitData("PS> ");
    reg.signal(s.id, { kind: "agent_exit" });
    expect(fake.written).toEqual([]);
  });

  it("only an ended agent session with a conversation is resumable; forget drops an ended one", async () => {
    const shell = await reg.create({ cwd: "D:\\p", kind: "shell", args: [] });
    const shellPty = fake;
    const agent = await reg.create({ cwd: "D:\\p", kind: "claude", args: [] });
    expect(reg.resumable(shell.id)).toBe(false);
    expect(reg.resumable(agent.id)).toBe(false);
    reg.setMeta(agent.id, { agentSessionId: "conv-1" });
    expect(reg.resumable(agent.id)).toBe(true);

    expect(() => reg.forget(shell.id)).toThrow(/bad_request: .*has not ended/);
    const { removed } = collect();
    shellPty.emitExit(0);
    reg.forget(shell.id);
    expect(removed).toEqual([shell.id]);
    expect(reg.get(shell.id)).toBeUndefined();
  });
});
