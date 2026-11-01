import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeLogger, createLogger } from "../../src/daemon/logger.js";

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
