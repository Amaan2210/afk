import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURES = new URL("../fixtures/", import.meta.url);

/** Reads `test/fixtures/<relPath>` as JSONL: one parsed value per non-empty line. */
export function readFixtureLines(relPath: string): unknown[] {
  return readFileSync(fileURLToPath(new URL(relPath, FIXTURES)), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}

/** Reads `test/fixtures/<relPath>` as one JSON document. */
export function readFixtureJson(relPath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relPath, FIXTURES)), "utf8")) as unknown;
}
