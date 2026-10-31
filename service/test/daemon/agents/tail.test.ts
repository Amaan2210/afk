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
function startTailer(opts: { fromStart?: boolean } = {}) {
  const t = new JsonlTailer(file, { pollMs: POLL_MS, ...opts });
  const lines: [unknown, number][] = [];
  const events: string[] = [];
  const errors: unknown[] = [];
  t.on("line", (obj: unknown, lineNo: number) => {
    lines.push([obj, lineNo]);
    events.push("line");
  });
  t.on("reset", () => events.push("reset"));
  t.on("error", (err: unknown) => errors.push(err));
  tailer = t;
  t.start();
  return { lines, events, errors };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-tail-"));
  file = join(dir, "t.jsonl");
});

afterEach(async () => {
  tailer?.stop();
  tailer = undefined;
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

  it("emits nothing after stop()", async () => {
    writeFileSync(file, '{"n":1}\n');
    const { lines } = startTailer();
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    tailer!.stop();
    appendFileSync(file, '{"n":2}\n');
    await pause(POLL_MS * 5);
    expect(lines).toHaveLength(1);
  });

  it("keeps delivering lines when a listener throws, and re-throws it as uncaught", async () => {
    // The tailer re-throws a listener's exception on the next tick. Run nextTick callbacks
    // through a catch so the test can see that exception instead of it failing the run.
    const rethrown: unknown[] = [];
    const realNextTick = process.nextTick.bind(process);
    vi.spyOn(process, "nextTick").mockImplementation((callback, ...args) =>
      realNextTick(() => {
        try {
          callback(...args);
        } catch (err) {
          rethrown.push(err);
        }
      }),
    );
    writeFileSync(file, "");
    const { lines, errors } = startTailer();
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
    await vi.waitFor(() => expect(rethrown).toEqual([bug]));
    expect(errors).toEqual([]); // not reported as an I/O error
  });
});
