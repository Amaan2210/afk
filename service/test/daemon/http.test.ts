import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { findRolloutFile } from "../../src/daemon/agents/codex/locate.js";
import type { ChatHub } from "../../src/daemon/agents/hub.js";
import { createHttpHandler, type HttpDeps, type HttpHandler } from "../../src/daemon/http.js";
import { SessionRegistry, type RegistryDeps } from "../../src/daemon/sessions/registry.js";
import type { Session, Strip } from "../../src/protocol/index.js";
import { createFakePty } from "../helpers/fake-pty.js";

vi.mock("../../src/daemon/agents/codex/locate.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/daemon/agents/codex/locate.js")>();
  return { ...original, findRolloutFile: vi.fn(original.findRolloutFile) };
});

const CWD = "D:\\Naya Repos\\proj";

/** Everything the handler does to the hub and the registry, in order. */
let calls: string[];
let attached: { claude: [string, string][]; codex: [string, string][] };
let strips: [string, Strip][];
let reg: SessionRegistry;
let deps: RegistryDeps;
let codexDir: string;
let server: Server;
let handler: HttpHandler;
let base: string;
let session: Session;
let clock: Date;
let agentNow: Date;
let attachThrows: boolean;
let isLoopback: (addr: string | undefined) => boolean;

const fakeHub = {
  attachClaude: (id: string, path: string) => {
    calls.push("attachClaude");
    attached.claude.push([id, path]);
  },
  attachCodex: (id: string, path: string) => {
    if (attachThrows) throw new Error("attach boom");
    calls.push("attachCodex");
    attached.codex.push([id, path]);
  },
  flush: () => calls.push("flush"),
  updateStrip: (id: string, strip: Strip) => strips.push([id, strip]),
} as unknown as ChatHub;

async function stopServer(): Promise<void> {
  handler.dispose();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function start(extra: Partial<HttpDeps> = {}): Promise<void> {
  if (server?.listening) await stopServer();
  handler = createHttpHandler({
    registry: reg,
    hub: fakeHub,
    version: "0.1.0",
    codexSessionsDir: codexDir,
    log: pino({ level: "silent" }),
    startedAt: Date.now() - 5500,
    now: () => agentNow,
    isLoopback: (addr) => isLoopback(addr),
    locateIntervalMs: 10,
    locateTimeoutMs: 200,
    ...extra,
  });
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-afk-session": session.id, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function get(path: string) {
  const res = await fetch(base + path);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function writeRollout(
  thread: string,
  cwd: string,
  day = "2026/10/31",
  timestamp = "2026-10-31T10:00:01Z",
): string {
  const dir = join(codexDir, ...day.split("/"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${timestamp.replace(/:/g, "-").slice(0, 19)}-${thread}.jsonl`);
  const first = { timestamp, type: "session_meta", payload: { id: thread, cwd } };
  writeFileSync(file, `${JSON.stringify(first)}\n`);
  return file;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await sleep(10);
  expect(check()).toBe(true);
}

beforeEach(async () => {
  calls = [];
  attached = { claude: [], codex: [] };
  strips = [];
  isLoopback = () => true;
  attachThrows = false;
  agentNow = new Date("2026-10-31T10:00:00.000Z");
  vi.mocked(findRolloutFile).mockClear();
  clock = new Date("2026-10-31T10:00:00.000Z");
  codexDir = mkdtempSync(join(tmpdir(), "afk-http-codex-"));
  const fakes = createFakePty();
  deps = {
    ptyFactory: (o) => fakes.factory(o),
    shell: { exe: "powershell.exe", kind: "powershell" },
    sessionsDir: await mkdtemp(join(tmpdir(), "afk-http-")),
    port: 2350,
    nodeExe: "node.exe",
    cliEntry: "cli.js",
    ringBufferBytes: 4096,
    snapshotScrollback: 100,
    retentionHours: 24,
    now: () => clock,
    baseEnv: { Path: "C:\\Windows" },
  };
  reg = new SessionRegistry(deps);
  reg.on("signal", (_id, s) => calls.push(`signal:${s.kind}`));
  session = await reg.create({ cwd: CWD, kind: "shell", args: [] });
  await start();
});

afterEach(async () => {
  await stopServer();
  await rm(deps.sessionsDir, { recursive: true, force: true });
  rmSync(codexDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("reports version and uptime in whole seconds", async () => {
    const { status, json } = await get("/health");
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, version: "0.1.0", uptimeSec: 5 });
  });
});

describe("Claude hooks", () => {
  it("SessionStart attaches the transcript and sets meta", async () => {
    const r = await post("/hooks/claude/SessionStart", {
      session_id: "sess-1",
      transcript_path: "C:\\t\\sess-1.jsonl",
      cwd: CWD,
    });
    expect(r).toEqual({ status: 200, json: {} });
    expect(attached.claude).toEqual([[session.id, "C:\\t\\sess-1.jsonl"]]);
    const rec = reg.get(session.id)!;
    expect(rec.session.kind).toBe("claude");
    expect(rec.session.agentSessionId).toBe("sess-1");
    expect(rec.meta.transcriptPath).toBe("C:\\t\\sess-1.jsonl");
  });

  it("SessionStart without a transcript path sets meta but attaches nothing", async () => {
    await post("/hooks/claude/SessionStart", { session_id: "sess-2" });
    expect(attached.claude).toEqual([]);
    expect(reg.get(session.id)!.session.agentSessionId).toBe("sess-2");
  });

  it("Stop signals turn_end", async () => {
    await post("/hooks/claude/UserPromptSubmit", {});
    expect(reg.get(session.id)!.session.state).toBe("working");
    const r = await post("/hooks/claude/Stop", {});
    expect(r.status).toBe(200);
    expect(reg.get(session.id)!.session.state).toBe("finished");
  });

  it("flushes the hub before every signal", async () => {
    await post("/hooks/claude/UserPromptSubmit", {});
    await post("/hooks/claude/Stop", {});
    expect(calls).toEqual(["flush", "signal:turn_start", "flush", "signal:turn_end"]);
  });

  it("an unknown event is a 400", async () => {
    const r = await post("/hooks/claude/Bogus", {});
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_request");
    expect(calls).toEqual([]);
  });
});

describe("POST /hooks/codex", () => {
  it("locates the rollout by thread id, flushes, and signals turn_end", async () => {
    const file = writeRollout("thread-1", CWD);
    const r = await post("/hooks/codex", {
      type: "agent-turn-complete",
      "thread-id": "thread-1",
      "last-assistant-message": "done",
    });
    expect(r.status).toBe(200);
    expect(attached.codex).toEqual([[session.id, file]]);
    const rec = reg.get(session.id)!;
    expect(rec.meta.rolloutPath).toBe(file);
    expect(rec.session.agentSessionId).toBe("thread-1");
    expect(rec.session.state).toBe("finished");
    expect(rec.session.lastMessage).toBe("done");
    expect(calls).toEqual(["attachCodex", "flush", "signal:turn_end"]);
  });

  it("re-attaches when the thread's rollout differs from the located one", async () => {
    const early = writeRollout("early", CWD, "2026/10/30");
    reg.setMeta(session.id, { rolloutPath: early });
    const real = writeRollout("thread-2", CWD);
    await post("/hooks/codex", { type: "agent-turn-complete", "thread-id": "thread-2" });
    expect(attached.codex).toEqual([[session.id, real]]);
    expect(reg.get(session.id)!.meta.rolloutPath).toBe(real);
  });

  it("does not re-attach when the path is unchanged, and still signals", async () => {
    const file = writeRollout("thread-3", CWD);
    reg.setMeta(session.id, { rolloutPath: file });
    await post("/hooks/codex", { type: "agent-turn-complete", "thread-id": "thread-3" });
    expect(attached.codex).toEqual([]);
    expect(reg.get(session.id)!.session.state).toBe("finished");
  });

  it("looks the thread up once while the session already follows it", async () => {
    writeRollout("thread-4", CWD);
    const notify = { type: "agent-turn-complete", "thread-id": "thread-4" };
    await post("/hooks/codex", notify);
    await post("/hooks/codex", notify);
    expect(findRolloutFile).toHaveBeenCalledTimes(1);
    expect(attached.codex).toHaveLength(1);
  });

  it("a notify without a thread id just signals", async () => {
    await post("/hooks/codex", { type: "agent-turn-complete" });
    expect(calls).toEqual(["flush", "signal:turn_end"]);
    expect(reg.get(session.id)!.session.agentSessionId).toBeUndefined();
  });

  it("truncates a long lastMessage to 200 characters including the ellipsis", async () => {
    await post("/hooks/codex", {
      type: "agent-turn-complete",
      "last-assistant-message": "x".repeat(500),
    });
    const last = reg.get(session.id)!.session.lastMessage!;
    expect(last).toHaveLength(200);
    expect(last.endsWith("…")).toBe(true);
  });
});

describe("POST /statusline", () => {
  it("updates the strip", async () => {
    const r = await post("/statusline", {
      model: { id: "m1", display_name: "Model One" },
      cost: { total_cost_usd: 1.5 },
    });
    expect(r.status).toBe(200);
    expect(strips).toHaveLength(1);
    expect(strips[0]![0]).toBe(session.id);
    expect(strips[0]![1]).toMatchObject({ model: { id: "m1", name: "Model One" }, costUsd: 1.5 });
  });
});

describe("agent lifecycle", () => {
  it("agent-start sets kind; agent-exit returns to idle keeping kind and clearing pending", async () => {
    expect(
      (await post(`/sessions/${session.id}/agent-start`, { kind: "claude", pid: 4 })).status,
    ).toBe(200);
    expect(reg.get(session.id)!.session.kind).toBe("claude");
    await post("/hooks/claude/PreToolUse", {
      tool_name: "AskUserQuestion",
      tool_use_id: "tu1",
      tool_input: { questions: [{ question: "Which?", options: [{ label: "A" }] }] },
    });
    expect(reg.get(session.id)!.session.state).toBe("needs_input");
    const r = await post(`/sessions/${session.id}/agent-exit`, { code: 0 });
    expect(r).toEqual({ status: 200, json: {} });
    const after = reg.get(session.id)!.session;
    expect(after.state).toBe("idle");
    expect(after.kind).toBe("claude");
    expect(after.pending).toBeUndefined();
  });

  it("agent-start with a bad kind is a 400 and leaves kind alone; an unknown :id is a 404", async () => {
    expect(
      (await post(`/sessions/${session.id}/agent-start`, { kind: "vim", pid: 1 })).status,
    ).toBe(400);
    expect(reg.get(session.id)!.session.kind).toBe("shell");
    expect((await post("/sessions/nope/agent-start", { kind: "claude", pid: 1 })).status).toBe(404);
    expect((await post("/sessions/nope/agent-exit", { code: 0 })).status).toBe(404);
  });

  describe("Codex rollout locate loop", () => {
    const startCodex = () => post(`/sessions/${session.id}/agent-start`, { kind: "codex", pid: 7 });
    /** Many attempts at the 10 ms interval, still well inside the 200 ms timeout. */
    const settle = () => sleep(100);

    it("finds the rollout after a delay and attaches once", async () => {
      await start({ locateTimeoutMs: 1000 });
      await startCodex();
      expect(reg.get(session.id)!.session.kind).toBe("codex");
      await sleep(40);
      expect(attached.codex).toEqual([]);
      const file = writeRollout("late", CWD);
      await until(() => attached.codex.length > 0);
      await sleep(60);
      expect(attached.codex).toEqual([[session.id, file]]);
      expect(reg.get(session.id)!.meta.rolloutPath).toBe(file);
    });

    it("gives up after the timeout", async () => {
      await startCodex();
      await sleep(350);
      writeRollout("too-late", CWD);
      await settle();
      expect(attached.codex).toEqual([]);
    });

    it("does not match a rollout that started before agent-start", async () => {
      agentNow = new Date("2026-10-31T10:05:00.000Z");
      writeRollout("older", CWD);
      await startCodex();
      await settle();
      expect(attached.codex).toEqual([]);
    });

    it("re-locates on a later agent-start in the same shell and replaces the old rollout", async () => {
      await start({ locateTimeoutMs: 1000 });
      const first = writeRollout("a", CWD);
      reg.setMeta(session.id, { rolloutPath: first });
      agentNow = new Date("2026-10-31T10:10:00.000Z");
      await startCodex();
      const second = writeRollout("b", CWD, "2026/10/31", "2026-10-31T10:10:30Z");
      await until(() => attached.codex.length === 1);
      expect(attached.codex[0]).toEqual([session.id, second]);
      await post(`/sessions/${session.id}/agent-exit`, { code: 0 });
      agentNow = new Date("2026-10-31T10:20:00.000Z");
      await startCodex();
      const third = writeRollout("c", CWD, "2026/10/31", "2026-10-31T10:20:05Z");
      await until(() => attached.codex.length === 2);
      expect(attached.codex[1]).toEqual([session.id, third]);
    });

    it("does not re-attach when the located rollout is the current one", async () => {
      const file = writeRollout("same", CWD);
      reg.setMeta(session.id, { rolloutPath: file });
      await startCodex();
      await settle();
      expect(attached.codex).toEqual([]);
    });

    it("a second agent-start cancels the first loop, which then cannot attach", async () => {
      let release!: (path: string) => void;
      const stalled = new Promise<string>((resolve) => (release = resolve));
      vi.mocked(findRolloutFile).mockImplementationOnce(() => stalled);
      await startCodex(); // loop 1's first lookup hangs
      const file = writeRollout("real", CWD);
      await startCodex(); // loop 2 finds the file
      await until(() => attached.codex.length === 1);
      release("C:\\stale.jsonl"); // loop 1 resumes with a different path
      await sleep(40);
      expect(attached.codex).toEqual([[session.id, file]]);
      expect(reg.get(session.id)!.meta.rolloutPath).toBe(file);
    });

    it("dispose() stops a running loop", async () => {
      await startCodex();
      handler.dispose();
      writeRollout("after-dispose", CWD);
      await settle();
      expect(attached.codex).toEqual([]);
    });

    it("agent-exit stops a running loop", async () => {
      await startCodex();
      await post(`/sessions/${session.id}/agent-exit`, { code: 0 });
      writeRollout("after-exit", CWD);
      await settle();
      expect(attached.codex).toEqual([]);
    });

    it("agent-start for claude cancels a running Codex loop", async () => {
      await startCodex();
      await post(`/sessions/${session.id}/agent-start`, { kind: "claude", pid: 8 });
      writeRollout("after-claude", CWD);
      await settle();
      expect(attached.codex).toEqual([]);
    });

    it("a failing attach is logged, not an unhandled rejection", async () => {
      const lines: string[] = [];
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => rejections.push(reason);
      process.on("unhandledRejection", onRejection);
      try {
        await start({
          log: pino({ level: "error" }, { write: (line: string) => void lines.push(line) }),
          locateTimeoutMs: 1000,
        });
        attachThrows = true;
        writeRollout("boom", CWD);
        await startCodex();
        await until(() => lines.length > 0);
        await sleep(30);
        expect(lines[0]).toContain("codex rollout attach failed");
        expect(rejections).toEqual([]);
      } finally {
        process.off("unhandledRejection", onRejection);
      }
    });
  });

  it("agent-start and agent-exit on an ended session are 200, change nothing and do not locate", async () => {
    reg.signal(session.id, { kind: "process_exit", exitCode: 0 });
    writeRollout("ended", CWD);
    expect(await post(`/sessions/${session.id}/agent-start`, { kind: "codex", pid: 1 })).toEqual({
      status: 200,
      json: {},
    });
    expect(await post(`/sessions/${session.id}/agent-exit`, { code: 0 })).toEqual({
      status: 200,
      json: {},
    });
    await sleep(100);
    expect(reg.get(session.id)!.session.kind).toBe("shell");
    expect(reg.get(session.id)!.session.state).toBe("ended");
    expect(attached.codex).toEqual([]);
    expect(findRolloutFile).not.toHaveBeenCalled();
  });
});

describe("guards", () => {
  it("a missing X-AFK-Session is a 400", async () => {
    const res = await fetch(`${base}/statusline`, { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_request" });
  });

  it("an unknown session is a 404", async () => {
    const r = await post("/hooks/claude/Stop", {}, { "x-afk-session": "nope" });
    expect(r).toEqual({ status: 404, json: { error: "not_found" } });
  });

  it("a non-loopback peer is a 403 before anything else", async () => {
    isLoopback = () => false;
    expect(await get("/nope")).toEqual({ status: 403, json: { error: "forbidden" } });
    expect(await get("/health")).toEqual({ status: 403, json: { error: "forbidden" } });
  });

  it("the default predicate allows loopback addresses only", async () => {
    await start({ isLoopback: undefined });
    expect((await get("/health")).status).toBe(200);
  });

  it("an unknown route or method is a 404", async () => {
    expect(await get("/nope")).toEqual({ status: 404, json: { error: "not_found" } });
    expect(await get("/statusline")).toEqual({ status: 404, json: { error: "not_found" } });
  });

  it("invalid JSON and non-object bodies are 400s", async () => {
    expect((await post("/statusline", "{not json")).status).toBe(400);
    expect((await post("/statusline", "[1,2]")).status).toBe(400);
    expect((await post("/statusline", "null")).status).toBe(400);
    expect(strips).toEqual([]);
  });

  it("a body over 1 MB is a 413 with Connection: close, and the server drops the socket", async () => {
    const res = await new Promise<{ status: number; connection: unknown }>((resolve, reject) => {
      const req = request(
        `${base}/statusline`,
        { method: "POST", headers: { "x-afk-session": session.id } },
        (r) => {
          r.resume();
          resolve({ status: r.statusCode ?? 0, connection: r.headers.connection });
        },
      );
      req.on("error", reject);
      req.end(Buffer.alloc(1024 * 1024 + 10, 97));
    });
    expect(res).toEqual({ status: 413, connection: "close" });
    const open = () =>
      new Promise<number>((resolve) => server.getConnections((_err, count) => resolve(count)));
    for (let i = 0; i < 100 && (await open()) > 0; i++) await sleep(10);
    expect(await open()).toBe(0);
    expect(strips).toEqual([]);
  });

  it("hooks for an ended session are 200 and apply nothing", async () => {
    reg.signal(session.id, { kind: "process_exit", exitCode: 0 });
    calls.length = 0;
    expect(await post("/hooks/claude/UserPromptSubmit", {})).toEqual({ status: 200, json: {} });
    expect(await post("/hooks/codex", { type: "agent-turn-complete" })).toEqual({
      status: 200,
      json: {},
    });
    expect(await post("/statusline", {})).toEqual({ status: 200, json: {} });
    expect(calls).toEqual([]);
    expect(strips).toEqual([]);
    expect(reg.get(session.id)!.session.state).toBe("ended");
  });

  it("an unexpected error is a 500 internal", async () => {
    const spy = vi.spyOn(reg, "signal").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await post("/hooks/claude/Stop", {})).toEqual({
      status: 500,
      json: { error: "internal" },
    });
    spy.mockRestore();
  });
});
