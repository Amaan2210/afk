import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parentUuidOf,
  SubagentWatcher,
  subagentDirFor,
  threadIdForAgentFile,
} from "../../../../src/daemon/agents/claude/subagents.js";
import { ClaudeTranscriptNormalizer } from "../../../../src/daemon/agents/claude/transcript.js";
import { readFixtureLines } from "../../../helpers/fixtures.js";

const POLL_MS = 20;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let dir: string;
let watcher: SubagentWatcher | undefined;

/** Starts a watcher on `watched` and records the files it reports. */
function watch(watched: string) {
  const seen: [string, string][] = [];
  watcher = new SubagentWatcher(watched, () => POLL_MS);
  watcher.on("file", (path: string, threadId: string) => seen.push([path, threadId]));
  watcher.start();
  return seen;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-subagents-"));
});

afterEach(async () => {
  watcher?.stop();
  watcher = undefined;
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("Claude sub-agent files", () => {
  it("derives the subagent dir and thread id", () => {
    expect(subagentDirFor("C:\\u\\.claude\\projects\\D--p\\sess-1.jsonl")).toBe(
      "C:\\u\\.claude\\projects\\D--p\\sess-1\\subagents",
    );
    expect(threadIdForAgentFile("agent-abc123.jsonl")).toBe("agent-abc123");
    expect(threadIdForAgentFile("C:\\u\\sess-1\\subagents\\agent-abc123.jsonl")).toBe(
      "agent-abc123",
    );
  });

  it("SubagentWatcher reports new agent files", async () => {
    const seen = watch(dir);
    await writeFile(join(dir, "agent-x.jsonl"), "");
    await vi.waitFor(() => expect(seen).toEqual([[join(dir, "agent-x.jsonl"), "agent-x"]]));
  });

  it("reports files already present once each, ignores other files, and stops", async () => {
    await writeFile(join(dir, "agent-a.jsonl"), "");
    await writeFile(join(dir, "notes.txt"), "");
    await writeFile(join(dir, "agent-b.json"), "");
    const seen = watch(dir);
    await vi.waitFor(() => expect(seen).toEqual([[join(dir, "agent-a.jsonl"), "agent-a"]]));
    await pause(POLL_MS * 3);
    expect(seen).toHaveLength(1);
    watcher!.stop();
    await writeFile(join(dir, "agent-c.jsonl"), "");
    await pause(POLL_MS * 3);
    expect(seen).toHaveLength(1);
  });

  it("tolerates the directory not existing yet", async () => {
    const sub = join(dir, "sess-1", "subagents");
    const seen = watch(sub);
    await pause(POLL_MS * 3); // a few polls find no directory
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, "agent-y.jsonl"), "");
    await vi.waitFor(() => expect(seen).toEqual([[join(sub, "agent-y.jsonl"), "agent-y"]]));
  });

  it("parentUuidOf reads parentLastUuid from a fork-context-ref line only", () => {
    const [first, ...rest] = readFixtureLines("claude/agent-abc123.jsonl");
    expect(parentUuidOf(first)).toBe("a3");
    for (const line of rest) expect(parentUuidOf(line)).toBeUndefined();
    for (const junk of [null, "x", { type: "fork-context-ref" }, { parentLastUuid: "a3" }]) {
      expect(parentUuidOf(junk)).toBeUndefined();
    }
  });

  it("normalises the sub-agent fixture with threadId agent-abc123", () => {
    const n = new ClaudeTranscriptNormalizer("agent-abc123");
    const ev = readFixtureLines("claude/agent-abc123.jsonl").flatMap((l) => n.push(l));
    expect(ev.map((e) => e.kind)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(ev.every((e) => e.threadId === "agent-abc123")).toBe(true);
  });
});
