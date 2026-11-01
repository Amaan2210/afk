import { appendFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInterruptLine } from "../../../src/daemon/agents/claude/transcript.js";
import { CodexRolloutNormalizer } from "../../../src/daemon/agents/codex/rollout.js";
import { ChatHub } from "../../../src/daemon/agents/hub.js";
import { SessionRegistry } from "../../../src/daemon/sessions/registry.js";
import type { AgentSignal, NotifyKind } from "../../../src/daemon/sessions/state.js";
import { createFakePty } from "../../helpers/fake-pty.js";
import { readFixtureLines } from "../../helpers/fixtures.js";

const POLL_MS = 20;
const CLAUDE = readFixtureLines("claude/interrupted.jsonl");
const CODEX = readFixtureLines("codex/interrupted.jsonl");
const uuidOf = (line: unknown) => (line as { uuid?: string }).uuid;

describe("interrupt markers in the agents' logs", () => {
  it("Claude: only the [Request interrupted by user …] user lines are interrupts", () => {
    expect(CLAUDE.filter(isInterruptLine).map(uuidOf)).toEqual(["i4", "i7"]);
    expect(
      isInterruptLine({ type: "user", message: { content: "[Request interrupted by user]" } }),
    ).toBe(true);
    const quoted = { type: "assistant", message: { content: "[Request interrupted by user]" } };
    expect(isInterruptLine(quoted)).toBe(false);
    expect(isInterruptLine(null)).toBe(false);
  });

  it("Codex: turn_aborted signals turn_abort", () => {
    const n = new CodexRolloutNormalizer();
    expect(CODEX.flatMap((line) => n.push(line).signals)).toEqual([
      { kind: "turn_start" },
      { kind: "turn_abort" },
    ]);
  });
});

describe("ChatHub and an interrupted turn", () => {
  let dir: string;
  let file: string;
  let registry: SessionRegistry;
  let hub: ChatHub;
  let sid: string;
  let signals: AgentSignal[];
  let notes: NotifyKind[];

  const write = (lines: unknown[]) =>
    writeFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const append = (lines: unknown[]) =>
    appendFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const markers = () =>
    hub
      .history(sid, "main")
      .filter((e) => e.kind === "turn")
      .map((e) => e.turn?.phase);
  const state = () => registry.get(sid)!.session.state;

  async function start(kind: "claude" | "codex"): Promise<void> {
    sid = (await registry.create({ cwd: dir, kind, args: [] })).id;
    registry.on("signal", (_id, s) => signals.push(s));
    registry.on("notify", (n) => notes.push(n.kind));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "afk-abort-"));
    file = join(dir, "log.jsonl");
    registry = new SessionRegistry({
      ptyFactory: createFakePty().factory,
      shell: { exe: "powershell.exe", kind: "powershell" },
      sessionsDir: join(dir, "sessions"),
      port: 2350,
      nodeExe: "node.exe",
      cliEntry: "cli.js",
      ringBufferBytes: 4096,
      snapshotScrollback: 100,
      retentionHours: 24,
      baseEnv: {},
    });
    hub = new ChatHub(registry, { pollMs: POLL_MS });
    signals = [];
    notes = [];
  });

  afterEach(async () => {
    for (const s of registry.list()) hub.detach(s.id);
    registry.stopAll();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it("Claude: an interrupt appended live returns the session to idle, without notify or end marker", async () => {
    await start("claude");
    write(CLAUDE.slice(0, 3));
    registry.signal(sid, { kind: "turn_start" });
    hub.attachClaude(sid, file);
    await vi.waitFor(() => expect(hub.history(sid, "main").map((e) => e.id)).toContain("toolu_i1"));
    expect(state()).toBe("working");

    append(CLAUDE.slice(3, 5));
    await vi.waitFor(() => expect(state()).toBe("idle"));
    expect(signals.filter((s) => s.kind === "turn_abort")).toHaveLength(1);
    expect(notes).toEqual([]);
    expect(markers()).toEqual(["start"]);
  });

  it("Claude: interrupts replayed from the file signal nothing", async () => {
    await start("claude");
    write(CLAUDE);
    registry.signal(sid, { kind: "turn_start" });
    hub.attachClaude(sid, file);
    await vi.waitFor(() => expect(hub.history(sid, "main").map((e) => e.id)).toContain("i7"));
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 3));
    expect(signals.filter((s) => s.kind === "turn_abort")).toEqual([]);
    expect(state()).toBe("working");
  });

  it("Codex: turn_aborted appended live returns the session to idle; replayed, it does not", async () => {
    await start("codex");
    write(CODEX.slice(0, 5));
    hub.attachCodex(sid, file);
    await vi.waitFor(() => expect(hub.history(sid, "main").map((e) => e.id)).toContain("c9"));
    registry.signal(sid, { kind: "turn_start" });
    append(CODEX.slice(5));
    await vi.waitFor(() => expect(state()).toBe("idle"));
    expect(notes).toEqual([]);

    const replayed = (await registry.create({ cwd: dir, kind: "codex", args: [] })).id;
    registry.signal(replayed, { kind: "turn_start" });
    hub.attachCodex(replayed, file);
    await vi.waitFor(() => expect(hub.history(replayed, "main").map((e) => e.id)).toContain("c9"));
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 3));
    expect(registry.get(replayed)!.session.state).toBe("working");
  });
});
