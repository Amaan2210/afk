import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRolloutFile, readSessionIndex } from "../../../../src/daemon/agents/codex/locate.js";

const FIXTURES = new URL("../../../fixtures/codex/", import.meta.url);
const rolloutText = readFileSync(fileURLToPath(new URL("rollout.jsonl", FIXTURES)), "utf8");
const CWD = "D:\\p";

let root: string;

function put(day: string, name: string, text: string): string {
  const dir = join(root, ...day.split("/"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

function meta(id: string, cwd: string, timestamp: string): string {
  return `${JSON.stringify({ timestamp, ordinal: 0, type: "session_meta", payload: { id, cwd } })}\n`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "afk-codex-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findRolloutFile", () => {
  it("finds a rollout by thread id and by cwd + since; unknown thread → undefined", async () => {
    const file = put("2026/10/30", "rollout-2026-10-30T12-33-11-thread-1.jsonl", rolloutText);
    expect(await findRolloutFile(root, { threadId: "thread-1" })).toBe(file);
    expect(await findRolloutFile(root, { cwd: CWD, since: new Date("2026-10-30T12:33:00Z") })).toBe(
      file,
    );
    expect(await findRolloutFile(root, { threadId: "nope" })).toBeUndefined();
  });

  it("returns the newest of several matches, searching newest days first", async () => {
    put(
      "2026/10/29",
      "rollout-2026-10-29T09-00-00-a.jsonl",
      meta("a", CWD, "2026-10-29T09:00:00Z"),
    );
    const newest = put(
      "2026/10/30",
      "rollout-2026-10-30T10-00-00-c.jsonl",
      meta("c", CWD, "2026-10-30T10:00:00Z"),
    );
    put(
      "2026/10/30",
      "rollout-2026-10-30T08-00-00-b.jsonl",
      meta("b", CWD, "2026-10-30T08:00:00Z"),
    );
    expect(await findRolloutFile(root, { cwd: CWD })).toBe(newest);
  });

  it("matches cwd case-insensitively with normalised separators", async () => {
    const file = put(
      "2026/10/30",
      "rollout-2026-10-30T10-00-00-a.jsonl",
      meta("a", "D:\\Work\\App", "2026-10-30T10:00:00Z"),
    );
    expect(await findRolloutFile(root, { cwd: "d:/work/app/" })).toBe(file);
    expect(await findRolloutFile(root, { cwd: "D:\\Work\\Other" })).toBeUndefined();
  });

  it("requires the rollout to start at or after since", async () => {
    put(
      "2026/10/30",
      "rollout-2026-10-30T10-00-00-a.jsonl",
      meta("a", CWD, "2026-10-30T10:00:00Z"),
    );
    const late = new Date("2026-10-30T10:00:01Z");
    expect(await findRolloutFile(root, { cwd: CWD, since: late })).toBeUndefined();
    const exact = new Date("2026-10-30T10:00:00Z");
    expect(await findRolloutFile(root, { cwd: CWD, since: exact })).toBeDefined();
  });

  it("with since, does not look in day folders more than a day before it", async () => {
    // Started after `since` by its meta, but filed two days before: a folder that old is skipped.
    put(
      "2026/10/28",
      "rollout-2026-10-28T23-00-00-old.jsonl",
      meta("old", CWD, "2026-10-30T10:00:00Z"),
    );
    const since = new Date("2026-10-30T09:00:00Z");
    expect(await findRolloutFile(root, { cwd: CWD, since })).toBeUndefined();
    // The day before is still searched: Codex files by local date, which can lag the UTC one.
    const file = put(
      "2026/10/29",
      "rollout-2026-10-29T23-30-00-tz.jsonl",
      meta("tz", CWD, "2026-10-30T09:30:00Z"),
    );
    expect(await findRolloutFile(root, { cwd: CWD, since })).toBe(file);
    // Without since, and by thread id, every folder is searched.
    expect(await findRolloutFile(root, { threadId: "old" })).toMatch(/old\.jsonl$/);
  });

  it("falls back to the file name timestamp when the meta has none", async () => {
    const line = JSON.stringify({ type: "session_meta", payload: { id: "a", cwd: CWD } });
    const file = put("2026/10/30", "rollout-2026-10-30T10-00-00-a.jsonl", `${line}\n`);
    const before = new Date("2026-10-30T09:59:00Z");
    expect(await findRolloutFile(root, { cwd: CWD, since: before })).toBe(file);
    const after = new Date("2026-10-30T10:01:00Z");
    expect(await findRolloutFile(root, { cwd: CWD, since: after })).toBeUndefined();
  });

  it("reads a first line larger than one read chunk", async () => {
    const big = JSON.stringify({
      timestamp: "2026-10-30T10:00:00Z",
      type: "session_meta",
      payload: { id: "a", cwd: CWD, base_instructions: "x".repeat(200_000) },
    });
    const file = put("2026/10/30", "rollout-2026-10-30T10-00-00-a.jsonl", `${big}\n{"more":1}\n`);
    expect(await findRolloutFile(root, { cwd: CWD })).toBe(file);
  });

  it("skips unreadable or malformed files and non-date directories", async () => {
    put("2026/10/30", "rollout-2026-10-30T10-00-00-a.jsonl", "not json\n");
    put("2026/10/30", "notes.txt", "x");
    put(
      "misc/10/30",
      "rollout-2026-10-30T11-00-00-z.jsonl",
      meta("z", CWD, "2026-10-30T11:00:00Z"),
    );
    mkdirSync(join(root, "2026", "10", "30", "rollout-2026-10-30T12-00-00-dir.jsonl"));
    expect(await findRolloutFile(root, { cwd: CWD })).toBeUndefined();
  });

  it("returns undefined for a missing sessions dir or an empty query", async () => {
    expect(await findRolloutFile(join(root, "absent"), { threadId: "a" })).toBeUndefined();
    put(
      "2026/10/30",
      "rollout-2026-10-30T10-00-00-a.jsonl",
      meta("a", CWD, "2026-10-30T10:00:00Z"),
    );
    expect(await findRolloutFile(root, {})).toBeUndefined();
  });
});

describe("readSessionIndex", () => {
  it("reads thread names from the fixture", async () => {
    const path = fileURLToPath(new URL("session_index.jsonl", FIXTURES));
    expect(await readSessionIndex(path)).toEqual([
      { id: "thread-1", threadName: "Add login", updatedAt: "2026-10-30T12:40:00.000Z" },
    ]);
  });

  it("skips malformed lines and entries without an id; missing file → []", async () => {
    const path = join(root, "index.jsonl");
    writeFileSync(path, 'oops\n{"thread_name":"x"}\n{"id":"b"}\n\n[1]\n');
    expect(await readSessionIndex(path)).toEqual([{ id: "b" }]);
    expect(await readSessionIndex(join(root, "absent.jsonl"))).toEqual([]);
  });
});
