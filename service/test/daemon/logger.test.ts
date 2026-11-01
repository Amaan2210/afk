import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeLogger, createLogger, pruneLogs } from "../../src/daemon/logger.js";

describe("createLogger", () => {
  it("writes JSON lines to a daily file in the log dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "afk-log-"));
    const logDir = join(root, "logs");
    try {
      const logger = createLogger(logDir, { sync: true });
      logger.info({ a: 1 }, "hello");
      const files = readdirSync(logDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^afk-\d{4}-\d{2}-\d{2}\.log$/);
      const line = JSON.parse(readFileSync(join(logDir, files[0]!), "utf8").trim()) as {
        msg: string;
        a: number;
      };
      expect(line.msg).toBe("hello");
      expect(line.a).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("closeLogger writes out queued lines, then drops later ones without throwing", async () => {
    const root = mkdtempSync(join(tmpdir(), "afk-log-"));
    const logDir = join(root, "logs");
    const lines = () => {
      const [file] = readdirSync(logDir);
      return readFileSync(join(logDir, file ?? ""), "utf8")
        .trim()
        .split("\n");
    };
    try {
      const logger = createLogger(logDir);
      for (let i = 0; i < 1000; i++) logger.info({ i }, "queued");
      await closeLogger(logger);
      expect(lines()).toHaveLength(1000);

      expect(() => logger.error("late")).not.toThrow();
      await closeLogger(logger);
      expect(lines()).toHaveLength(1000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("pruneLogs", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date("2026-11-01T12:00:00Z");

  it("deletes the daemon's logs last written more than 14 days ago, and nothing else", async () => {
    const root = mkdtempSync(join(tmpdir(), "afk-log-prune-"));
    const logDir = join(root, "logs");
    try {
      await mkdir(logDir);
      const ages: [string, number][] = [
        ["afk-2026-10-01.log", 31],
        ["afk-2026-10-17.log", 15],
        ["afk-2026-10-18.log", 14.5],
        ["afk-2026-10-19.log", 13],
        // Today's file, whatever its time says: the daemon is about to write to it.
        ["afk-2026-11-01.log", 40],
        ["notes.log", 40],
        ["afk-old.txt", 40],
      ];
      for (const [name, days] of ages) {
        const file = join(logDir, name);
        await writeFile(file, "{}");
        const t = new Date(now.getTime() - days * DAY);
        await utimes(file, t, t);
      }
      expect((await pruneLogs(logDir, now)).sort()).toEqual([
        "afk-2026-10-01.log",
        "afk-2026-10-17.log",
        "afk-2026-10-18.log",
      ]);
      expect((await readdir(logDir)).sort()).toEqual([
        "afk-2026-10-19.log",
        "afk-2026-11-01.log",
        "afk-old.txt",
        "notes.log",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips an entry it cannot remove and still prunes the rest", async () => {
    const root = mkdtempSync(join(tmpdir(), "afk-log-prune-"));
    const logDir = join(root, "logs");
    try {
      await mkdir(logDir);
      // A folder named like an old log: stat works, but rm without recursive refuses it.
      const folder = join(logDir, "afk-2026-09-01.log");
      await mkdir(folder);
      const file = join(logDir, "afk-2026-09-02.log");
      await writeFile(file, "");
      const t = new Date(now.getTime() - 60 * DAY);
      await utimes(folder, t, t);
      await utimes(file, t, t);
      expect(await pruneLogs(logDir, now)).toEqual(["afk-2026-09-02.log"]);
      expect(await readdir(logDir)).toEqual(["afk-2026-09-01.log"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does nothing when the folder is missing", async () => {
    expect(await pruneLogs(join(tmpdir(), "afk-no-such-logs"), now)).toEqual([]);
  });
});
