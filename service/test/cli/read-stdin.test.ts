import { PassThrough } from "node:stream";
import { runHook } from "../../src/cli/hook.js";
import type { PostFn } from "../../src/cli/post.js";
import { readStdin } from "../../src/cli/read-stdin.js";

const ENV = { AFK_SESSION_ID: "s_x", AFK_PORT: "4321" };

function input(text: string): PassThrough {
  const s = new PassThrough();
  s.end(text);
  return s;
}

afterEach(() => {
  vi.useRealTimers();
});

/** Resolves `readStdin`, recording when (in fake ms) and why it stopped. */
function track(stream: PassThrough) {
  const cuts: [string, number][] = [];
  const started = Date.now();
  let doneAt: number | undefined;
  const text = readStdin(stream, { onCut: (why, bytes) => cuts.push([why, bytes]) }).then((t) => {
    doneAt = Date.now() - started;
    return t;
  });
  return { text, cuts, doneAt: () => doneAt };
}

describe("readStdin", () => {
  it("reads a payload that trickles in for longer than half a second, chunk by chunk", async () => {
    vi.useFakeTimers();
    const s = new PassThrough();
    const r = track(s);
    // 800 ms in all: past the old fixed 500 ms deadline, within the 1 s cap.
    for (const part of ['{"a":', '"slow', " payload", '"}']) {
      s.write(part);
      await vi.advanceTimersByTimeAsync(200);
    }
    s.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(await r.text).toBe('{"a":"slow payload"}');
    expect(r.cuts).toEqual([]);
  });

  it("gives up 300 ms after the last byte when the stream stays open", async () => {
    vi.useFakeTimers();
    const s = new PassThrough();
    const r = track(s);
    s.write("{");
    await vi.advanceTimersByTimeAsync(100);
    s.write('"a":1');
    await vi.advanceTimersByTimeAsync(299);
    expect(r.doneAt()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await r.text).toBe('{"a":1');
    expect(r.doneAt()).toBe(400);
    expect(r.cuts).toEqual([["idle", 6]]);
  });

  it("gives up at 1 s however steadily bytes keep arriving", async () => {
    vi.useFakeTimers();
    const s = new PassThrough();
    const r = track(s);
    for (let i = 0; i < 8; i++) {
      s.write("x");
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(await r.text).toBe("xxxxx");
    expect(r.doneAt()).toBe(1000);
    expect(r.cuts).toEqual([["cap", 5]]);
  });

  it("returns at once when the stream ends, cutting nothing", async () => {
    const s = new PassThrough();
    s.end('{"b":2}');
    const r = track(s);
    expect(await r.text).toBe('{"b":2}');
    expect(r.cuts).toEqual([]);
  });
});

describe("runHook and a dropped payload", () => {
  function recordingPost() {
    const calls: unknown[][] = [];
    const post = (async (...args: unknown[]) => {
      calls.push(args);
      return true;
    }) as PostFn;
    return { post, calls };
  }

  it("tells the daemon why, which logs it at debug level (afk daemon --verbose)", async () => {
    const { post, calls } = recordingPost();
    const stdin = new PassThrough();
    stdin.write('{"partial":');
    expect(await runHook("Stop", { stdin, env: ENV, post })).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 4)).toEqual([
      4321,
      "/hooks/dropped",
      { event: "Stop", reason: "no input for 300 ms after 11 bytes, not valid JSON" },
      { "X-AFK-Session": "s_x" },
    ]);
  });

  it("a payload that is merely malformed is reported as such", async () => {
    const { post, calls } = recordingPost();
    expect(await runHook("Stop", { stdin: input("{nope"), env: ENV, post })).toBe(0);
    expect(calls.map((c) => c.slice(1, 3))).toEqual([
      ["/hooks/dropped", { event: "Stop", reason: "not valid JSON" }],
    ]);
  });

  it("a complete payload on a stdin left open is relayed, not dropped", async () => {
    const { post, calls } = recordingPost();
    const stdin = new PassThrough();
    stdin.write('{"a":1}');
    expect(await runHook("Stop", { stdin, env: ENV, post })).toBe(0);
    expect(calls.map((c) => c.slice(1, 3))).toEqual([["/hooks/claude/Stop", { a: 1 }]]);
  });
});
