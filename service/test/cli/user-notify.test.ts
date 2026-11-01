import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { runHook } from "../../src/cli/hook.js";
import type { PostFn } from "../../src/cli/post.js";
import { userNotifyCommand, type NotifySpawn } from "../../src/cli/user-notify.js";

/** A temporary CODEX_HOME: the user's own ~/.codex is never read here. */
let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "afk-codex-home-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5 });
});

const writeConfig = (text: string) => writeFile(path.join(home, "config.toml"), text);
/** A TOML array of literal strings, so Windows paths need no escaping. */
const tomlList = (items: string[]) => `[${items.map((i) => `'${i}'`).join(", ")}]`;

describe("userNotifyCommand", () => {
  it("is the top-level notify of $CODEX_HOME/config.toml", async () => {
    await writeConfig(
      'model = "o4-mini"\nnotify = ["notify-send", "--app", "codex"]\n\n[profiles.work]\nnotify = ["other"]\n',
    );
    expect(await userNotifyCommand({ CODEX_HOME: home })).toEqual([
      "notify-send",
      "--app",
      "codex",
    ]);
  });

  it("defaults to ~/.codex/config.toml", async () => {
    await mkdir(path.join(home, ".codex"));
    await writeFile(path.join(home, ".codex", "config.toml"), 'notify = ["toast"]\n');
    expect(await userNotifyCommand({}, () => home)).toEqual(["toast"]);
  });

  it.each([
    ["there is no config file", undefined],
    ["it sets no notify", 'model = "o4-mini"\n'],
    ["the file is not TOML", "notify = [\n"],
    ["notify is not a list", 'notify = "toast"\n'],
    ["notify is empty", "notify = []\n"],
    ["notify holds a non-string", 'notify = ["toast", 1]\n'],
  ])("is undefined when %s", async (_, text) => {
    if (text !== undefined) await writeConfig(text);
    expect(await userNotifyCommand({ CODEX_HOME: home })).toBeUndefined();
  });
});

describe("afk hook codex-notify and the user's own notify", () => {
  const PAYLOAD = '{"type":"agent-turn-complete","last-assistant-message":"Done & \\"dusted\\""}';
  const SESSION = { AFK_SESSION_ID: "s_x", AFK_PORT: "4321" };

  function recorder(postResult = true) {
    const order: string[] = [];
    const spawned: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const post = (async (_port: number, route: string) => {
      order.push(`post ${route}`);
      return postResult;
    }) as PostFn;
    const spawnNotify: NotifySpawn = (file, args, env) => {
      order.push(`spawn ${file}`);
      spawned.push({ file, args, env });
    };
    return { order, spawned, post, spawnNotify };
  }

  const hook = (env: NodeJS.ProcessEnv, r: ReturnType<typeof recorder>, event = "codex-notify") =>
    runHook(event, {
      stdin: new PassThrough(),
      env,
      post: r.post,
      args: [PAYLOAD],
      spawnNotify: r.spawnNotify,
    });

  it("relays to the daemon first, then runs the user's notify with the same JSON last", async () => {
    await writeConfig("notify = ['notify-send', '--app', 'codex']\n");
    const r = recorder();
    expect(await hook({ ...SESSION, CODEX_HOME: home, Path: "C:\\Windows" }, r)).toBe(0);
    expect(r.order).toEqual(["post /hooks/codex", "spawn notify-send"]);
    expect(r.spawned[0]?.args).toEqual(["--app", "codex", PAYLOAD]);
    // Not an AFK session's relay itself, and marked so it never chains again.
    expect(r.spawned[0]?.env).toEqual({
      CODEX_HOME: home,
      Path: "C:\\Windows",
      AFK_NOTIFY_CHAINED: "1",
    });
  });

  it("runs it even when the daemon is down or there is no session", async () => {
    await writeConfig("notify = ['toast']\n");
    const down = recorder(false);
    await hook({ ...SESSION, CODEX_HOME: home }, down);
    expect(down.order).toEqual(["post /hooks/codex", "spawn toast"]);
    const outside = recorder();
    await hook({ CODEX_HOME: home }, outside);
    expect(outside.order).toEqual(["spawn toast"]);
  });

  it("does not run it from a notify it started, nor for a Claude hook", async () => {
    await writeConfig("notify = ['toast']\n");
    const chained = recorder();
    await hook({ ...SESSION, CODEX_HOME: home, AFK_NOTIFY_CHAINED: "1" }, chained);
    expect(chained.order).toEqual(["post /hooks/codex"]);
    const claude = recorder();
    await hook({ ...SESSION, CODEX_HOME: home }, claude, "Stop");
    expect(claude.spawned).toEqual([]);
  });

  it("ignores a notify that fails to start", async () => {
    await writeConfig("notify = ['toast']\n");
    const r = recorder();
    const code = await runHook("codex-notify", {
      stdin: new PassThrough(),
      env: { ...SESSION, CODEX_HOME: home },
      post: r.post,
      args: [PAYLOAD],
      spawnNotify: () => {
        throw new Error("spawn EINVAL");
      },
    });
    expect(code).toBe(0);
  });

  it("starts the real program, detached, with the payload as its last argument", async () => {
    const script = path.join(home, "notify.cjs");
    const out = path.join(home, "notify-out.json");
    await writeFile(
      script,
      "require('fs').writeFileSync(process.env.NOTIFY_OUT, JSON.stringify({ args: process.argv.slice(2), session: process.env.AFK_SESSION_ID ?? null }));\n",
    );
    await writeConfig(`notify = ${tomlList([process.execPath, script, "--flag"])}\n`);
    const r = recorder();
    await runHook("codex-notify", {
      stdin: new PassThrough(),
      env: { ...process.env, ...SESSION, CODEX_HOME: home, NOTIFY_OUT: out },
      post: r.post,
      args: [PAYLOAD],
    });
    const written = await vi.waitFor(() => readFile(out, "utf8"), { timeout: 10_000 });
    expect(JSON.parse(written)).toEqual({ args: ["--flag", PAYLOAD], session: null });
  });
});
