import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { runHook } from "../../src/cli/hook.js";
import { postLoopback, type PostFn } from "../../src/cli/post.js";
import { runStatusline } from "../../src/cli/statusline.js";

const ENV = { AFK_SESSION_ID: "s_x", AFK_PORT: "4321" };

function fakePost(result = true): { post: PostFn; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const post = (async (...args: unknown[]) => {
    calls.push(args);
    return result;
  }) as PostFn;
  return { post, calls };
}

function input(text: string): PassThrough {
  const s = new PassThrough();
  s.end(text);
  return s;
}

describe("postLoopback", () => {
  it("resolves false quickly when nothing listens (closed port)", async () => {
    const t = Date.now();
    expect(await postLoopback(1, "/hooks/claude/Stop", {}, {}, 300)).toBe(false);
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("posts JSON with the headers and resolves true on 200", async () => {
    let seen: { url?: string; session?: string; body: string } = { body: "" };
    const server = createServer((req, res) => {
      req.on("data", (c: Buffer) => (seen.body += c.toString()));
      req.on("end", () => {
        seen = { ...seen, url: req.url, session: String(req.headers["x-afk-session"]) };
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    try {
      expect(await postLoopback(port, "/statusline", { a: 1 }, { "X-AFK-Session": "s_1" })).toBe(
        true,
      );
      expect(seen).toEqual({ url: "/statusline", session: "s_1", body: '{"a":1}' });
    } finally {
      server.close();
    }
  });

  it("resolves false when the daemon never answers", async () => {
    const server = createServer(() => undefined);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    try {
      expect(await postLoopback(port, "/x", {}, {}, 200)).toBe(false);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe("runHook", () => {
  it("posts stdin JSON to /hooks/claude/<event> with X-AFK-Session and returns 0", async () => {
    const { post, calls } = fakePost();
    const code = await runHook("Stop", { stdin: input('{"a":1}'), env: ENV, post });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 4)).toEqual([
      4321,
      "/hooks/claude/Stop",
      { a: 1 },
      { "X-AFK-Session": "s_x" },
    ]);
  });

  it("returns 0 on malformed stdin and when post fails", async () => {
    const bad = fakePost();
    expect(await runHook("Stop", { stdin: input("{nope"), env: ENV, post: bad.post })).toBe(0);
    // Only the notice that it was dropped (see read-stdin.test.ts) reaches the daemon.
    expect(bad.calls.map((c) => c[1])).toEqual(["/hooks/dropped"]);
    const down = fakePost(false);
    expect(await runHook("Stop", { stdin: input("{}"), env: ENV, post: down.post })).toBe(0);
    const throwing = (async () => {
      throw new Error("boom");
    }) as PostFn;
    expect(await runHook("Stop", { stdin: input("{}"), env: ENV, post: throwing })).toBe(0);
  });

  it("does nothing without a session id", async () => {
    const { post, calls } = fakePost();
    await runHook("Stop", { stdin: input("{}"), env: {}, post });
    expect(calls).toHaveLength(0);
  });

  it("codex-notify posts the last argv JSON to /hooks/codex", async () => {
    const { post, calls } = fakePost();
    await runHook("codex-notify", {
      stdin: new PassThrough(),
      env: ENV,
      post,
      args: ['{"type":"agent-turn-complete"}'],
    });
    expect(calls[0]?.slice(0, 4)).toEqual([
      4321,
      "/hooks/codex",
      { type: "agent-turn-complete" },
      { "X-AFK-Session": "s_x" },
    ]);
  });

  it("gives up on a stdin that never closes", async () => {
    const { post } = fakePost();
    const t = Date.now();
    expect(await runHook("Stop", { stdin: new PassThrough(), env: ENV, post })).toBe(0);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe("runStatusline", () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "afk-sl-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const echoCommand = `node -e "process.stdin.pipe(process.stdout)"`;
  const settings = (file: string, command: string): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ statusLine: { type: "command", command } }));
  };
  const run = async (json: string, userSettingsPath: string, post: PostFn) => {
    const stdout = new PassThrough();
    let out = "";
    stdout.on("data", (c: Buffer) => (out += c.toString()));
    const code = await runStatusline({
      stdin: input(json),
      stdout,
      env: { ...process.env, ...ENV },
      post,
      userSettingsPath,
      cwd: dir,
    });
    return { code, out };
  };

  it("posts and pipes the JSON to the original command, relaying its stdout", async () => {
    const user = path.join(dir, "user.json");
    settings(user, echoCommand);
    const { post, calls } = fakePost();
    const json = JSON.stringify({ cwd: dir });
    const r = await run(json, user, post);
    expect(r).toEqual({ code: 0, out: json });
    expect(calls[0]?.slice(0, 2)).toEqual([4321, "/statusline"]);
  });

  it("prefers the project's settings.local.json, then settings.json, over the user's", async () => {
    const user = path.join(dir, "user.json");
    settings(user, `node -e "process.stdout.write('user')"`);
    settings(path.join(dir, ".claude", "settings.json"), `node -e "process.stdout.write('proj')"`);
    const { post } = fakePost();
    const json = JSON.stringify({ workspace: { project_dir: dir } });
    expect((await run(json, user, post)).out).toBe("proj");
    settings(
      path.join(dir, ".claude", "settings.local.json"),
      `node -e "process.stdout.write('local')"`,
    );
    expect((await run(json, user, post)).out).toBe("local");
  });

  it("with no original command prints nothing and returns 0", async () => {
    const { post, calls } = fakePost();
    const r = await run("{}", path.join(dir, "missing.json"), post);
    expect(r).toEqual({ code: 0, out: "" });
    expect(calls).toHaveLength(1);
  });

  it("ignores an invalid settings file and still returns 0 when the daemon is down", async () => {
    const user = path.join(dir, "user.json");
    writeFileSync(user, "{not json");
    const r = await run("{}", user, fakePost(false).post);
    expect(r).toEqual({ code: 0, out: "" });
  });

  it("does not wait for a slow post before running the original", async () => {
    const user = path.join(dir, "user.json");
    settings(user, echoCommand);
    let release: () => void = () => undefined;
    const slow = (() => new Promise<boolean>((r) => (release = () => r(false)))) as PostFn;
    const stdout = new PassThrough();
    let out = "";
    stdout.on("data", (c: Buffer) => (out += c.toString()));
    const done = runStatusline({
      stdin: input("{}"),
      stdout,
      env: { ...process.env, ...ENV },
      post: slow,
      userSettingsPath: user,
      cwd: dir,
    });
    await vi.waitFor(() => expect(out).toBe("{}"), { timeout: 5000 });
    release();
    expect(await done).toBe(0);
  });
});
