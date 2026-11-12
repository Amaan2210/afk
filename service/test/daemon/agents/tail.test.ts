import { appendFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlTailer } from "../../../src/daemon/agents/tail.js";

const POLL_MS = 20;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let dir: string;
let file: string;
let tailer: JsonlTailer | undefined;

/** Starts a tailer on `file` and records what it emits. */
function startTailer(opts: { fromStart?: boolean; rethrow?: (err: unknown) => void } = {}) {
  const t = new JsonlTailer(file, { pollMs: POLL_MS, ...opts });
  const lines: [unknown, number][] = [];
  const events: string[] = [];
  const errors: unknown[] = [];
  /** How many lines had been emitted each time `caughtUp` fired. */
  const caughtUpAt: number[] = [];
  t.on("line", (obj: unknown, lineNo: number) => {
    lines.push([obj, lineNo]);
    events.push("line");
  });
  t.on("reset", () => events.push("reset"));
  t.on("caughtUp", () => caughtUpAt.push(lines.length));
  t.on("error", (err: unknown) => errors.push(err));
  tailer = t;
  t.start();
  return { lines, events, errors, caughtUpAt };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-tail-"));
  file = join(dir, "t.jsonl");
});

afterEach(async () => {
  tailer?.stop();
  tailer = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("JsonlTailer", () => {
  it("emits existing lines then appended lines, skipping malformed JSON", async () => {
    writeFileSync(file, '{"n":1}\n{"n":2}\n');
    const { lines, errors } = startTailer();
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    appendFileSync(file, "{bad\n");
    appendFileSync(file, '{"n":3}\n');
    await vi.waitFor(() => expect(lines).toHaveLength(3));
    expect(lines).toEqual([
      [{ n: 1 }, 1],
      [{ n: 2 }, 2],
      [{ n: 3 }, 4],
    ]);
    expect(errors).toEqual([]);
  });

  it("handles a line whose bytes arrive in two writes (multi-byte split)", async () => {
    writeFileSync(file, "");
    const line = Buffer.from('{"text":"café"}\n', "utf8");
    const cut = line.indexOf(0xa9); // between the two bytes of "é" (0xc3 0xa9)
    expect(line[cut - 1]).toBe(0xc3);
    const { lines } = startTailer();
    // One write carries a whole line and the first half of the next, so the read that emits
    // {"n":1} has also consumed the dangling 0xc3.
    appendFileSync(file, Buffer.concat([Buffer.from('{"n":1}\n'), line.subarray(0, cut)]));
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    appendFileSync(file, line.subarray(cut));
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines[1]).toEqual([{ text: "café" }, 2]);
  });

  it("emits reset when the file is truncated and resumes from the start", async () => {
    writeFileSync(file, '{"n":1}\n{"n":2}\n{"partial":');
    const { lines, events } = startTailer();
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    writeFileSync(file, '{"n":9}\n'); // shorter than what was already read
    await vi.waitFor(() => expect(lines).toHaveLength(3));
    expect(events).toEqual(["line", "line", "reset", "line"]);
    // The carried partial line was dropped and line numbers restarted.
    expect(lines[2]).toEqual([{ n: 9 }, 1]);
  });

  it("waits for a file that does not exist yet", async () => {
    const { lines, errors } = startTailer();
    await pause(POLL_MS * 3); // a few polls find nothing
    writeFileSync(file, '{"n":1}\n');
    await vi.waitFor(() => expect(lines).toEqual([[{ n: 1 }, 1]]));
    expect(errors).toEqual([]);
  });

  it("with fromStart false skips the existing content and emits only appended lines", async () => {
    writeFileSync(file, '{"n":1}\n{"n":2}\n');
    const { lines } = startTailer({ fromStart: false });
    appendFileSync(file, '{"n":3}\n');
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    expect(lines[0][0]).toEqual({ n: 3 });
  });

  it("emits caughtUp once, after the lines already in the file", async () => {
    writeFileSync(file, '{"n":1}\n{"n":2}\n');
    const { lines, caughtUpAt } = startTailer();
    await vi.waitFor(() => expect(caughtUpAt).toEqual([2]));
    appendFileSync(file, '{"n":3}\n');
    await vi.waitFor(() => expect(lines).toHaveLength(3));
    await pause(POLL_MS * 3);
    expect(caughtUpAt).toEqual([2]);
  });

  it("emits caughtUp on the first poll when the file does not exist yet", async () => {
    const { lines, caughtUpAt } = startTailer();
    await vi.waitFor(() => expect(caughtUpAt).toEqual([0]));
    writeFileSync(file, '{"n":1}\n');
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    await pause(POLL_MS * 3);
    expect(caughtUpAt).toEqual([0]);
  });

  it("with fromStart false emits caughtUp after its first poll", async () => {
    writeFileSync(file, '{"n":1}\n{"n":2}\n');
    const { lines, caughtUpAt } = startTailer({ fromStart: false });
    await vi.waitFor(() => expect(caughtUpAt).toEqual([0]));
    appendFileSync(file, '{"n":3}\n');
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    expect(caughtUpAt).toEqual([0]);
  });

  it("emits caughtUp again once the file has been re-read after a reset", async () => {
    writeFileSync(file, '{"n":1}\n{"n":2}\n');
    const { lines, events, caughtUpAt } = startTailer();
    await vi.waitFor(() => expect(caughtUpAt).toEqual([2]));
    writeFileSync(file, '{"n":9}\n'); // shorter than what was already read
    await vi.waitFor(() => expect(caughtUpAt).toEqual([2, 3]));
    expect(events).toEqual(["line", "line", "reset", "line"]);
    expect(lines[2]).toEqual([{ n: 9 }, 1]);
  });

  it("drain reads what was appended at once and keeps a single poll timer", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    writeFileSync(file, '{"n":1}\n');
    const { lines, caughtUpAt } = startTailer();
    expect(vi.getTimerCount()).toBe(1);
    tailer!.drain(); // the first read happens now instead of on the scheduled poll
    expect(lines).toEqual([[{ n: 1 }, 1]]);
    expect(caughtUpAt).toEqual([1]);
    appendFileSync(file, '{"n":2}\n');
    tailer!.drain();
    tailer!.drain();
    expect(lines).toEqual([
      [{ n: 1 }, 1],
      [{ n: 2 }, 2],
    ]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(POLL_MS * 3);
    expect(lines).toHaveLength(2);
    expect(caughtUpAt).toEqual([1]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a pollMs function is asked before every wait, so the pace can change", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    writeFileSync(file, '{"n":1}\n');
    let pollMs = POLL_MS * 10;
    const lines: unknown[] = [];
    tailer = new JsonlTailer(file, { pollMs: () => pollMs });
    tailer.on("line", (obj) => lines.push(obj));
    tailer.start();
    vi.advanceTimersByTime(0); // the first read; the next is the slow wait away
    appendFileSync(file, '{"n":2}\n');
    vi.advanceTimersByTime(POLL_MS * 9);
    expect(lines).toHaveLength(1);
    pollMs = POLL_MS;
    vi.advanceTimersByTime(POLL_MS); // the slow wait ends; later waits are short
    expect(lines).toHaveLength(2);
    appendFileSync(file, '{"n":3}\n');
    vi.advanceTimersByTime(POLL_MS);
    expect(lines).toHaveLength(3);
  });

  it("drain from a listener while the tailer is reading does nothing", async () => {
    writeFileSync(file, '{"n":1}\n{"n":2}\n');
    const { lines, caughtUpAt } = startTailer();
    // A nested read would find nothing left and report caughtUp before line 2 is delivered.
    tailer!.prependListener("line", () => tailer!.drain());
    await vi.waitFor(() => expect(caughtUpAt).toEqual([2]));
    expect(lines).toEqual([
      [{ n: 1 }, 1],
      [{ n: 2 }, 2],
    ]);
  });

  it("drain does nothing once stopped", () => {
    writeFileSync(file, '{"n":1}\n');
    const { lines, caughtUpAt } = startTailer();
    tailer!.stop();
    tailer!.drain();
    expect(lines).toEqual([]);
    expect(caughtUpAt).toEqual([]);
  });

  it("emits nothing after stop()", async () => {
    writeFileSync(file, '{"n":1}\n');
    const { lines } = startTailer();
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    tailer!.stop();
    appendFileSync(file, '{"n":2}\n');
    await pause(POLL_MS * 5);
    expect(lines).toHaveLength(1);
  });

  it("keeps delivering lines when a listener throws, and re-throws it", async () => {
    // Caught through the tailer's own hook: spying on the process-wide nextTick also caught
    // whatever else the test worker scheduled on it.
    const rethrown: unknown[] = [];
    writeFileSync(file, "");
    const { lines, errors } = startTailer({ rethrow: (err) => rethrown.push(err) });
    const bug = new Error("listener bug");
    const before: unknown[] = [];
    tailer!.prependListener("line", (obj: unknown) => {
      before.push(obj);
      if (before.length === 1) throw bug;
    });
    // Two complete lines and a partial third arrive in one read.
    appendFileSync(file, '{"n":1}\n{"n":2}\n{"n":');
    await vi.waitFor(() => expect(before).toHaveLength(2));
    appendFileSync(file, "3}\n");
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    // The throwing listener got every line; the one after it missed only the line it threw on.
    expect(before).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(lines).toEqual([
      [{ n: 2 }, 2],
      [{ n: 3 }, 3],
    ]);
    expect(rethrown).toEqual([bug]);
    expect(errors).toEqual([]); // not reported as an I/O error
  });

  it("by default re-throws a listener's exception on the next tick, as uncaught", async () => {
    const bug = new Error("listener bug");
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    // Vitest's own handler would fail the run; this one sees the exception first.
    const theirs = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    process.on("uncaughtException", onUncaught);
    try {
      writeFileSync(file, '{"n":1}\n');
      const t = new JsonlTailer(file, { pollMs: POLL_MS });
      tailer = t;
      t.on("line", () => {
        throw bug;
      });
      t.start();
      await vi.waitFor(() => expect(uncaught).toEqual([bug]));
    } finally {
      process.off("uncaughtException", onUncaught);
      for (const listener of theirs) process.on("uncaughtException", listener);
    }
  });
});
