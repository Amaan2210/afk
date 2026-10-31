import { isRecord } from "../../util/is-record.js";

/** Longest summary taken from a tool's named input field. */
const NAMED_SUMMARY_MAX = 120;
/** Longest summary taken from an unknown tool's first string value. */
const DEFAULT_SUMMARY_MAX = 60;

/** The input fields that summarise each known tool, tried in order (Grep is handled separately). */
const SUMMARY_FIELDS = new Map<string, readonly string[]>([
  ["Bash", ["command"]],
  ["Edit", ["file_path"]],
  ["Write", ["file_path"]],
  ["Read", ["file_path"]],
  ["NotebookEdit", ["notebook_path", "file_path"]],
  ["Glob", ["pattern"]],
  ["Agent", ["description"]],
  ["WebSearch", ["query"]],
  ["WebFetch", ["url"]],
]);

/** `text` cut to `max` characters with a trailing "…" when it is longer. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The first line of `text`, at most `max` characters, ending in "…" when anything was cut. */
function firstLine(text: string, max: number): string {
  const trimmed = text.trimStart();
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return truncate(trimmed, max);
  const line = trimmed.slice(0, newline).trimEnd();
  return line.length > max ? truncate(line, max) : `${line}…`;
}

/**
 * A one-line summary of a tool call's input for a chat tool card: the tool's telling field
 * (the command, the file, the search), else the input's first string value, shortened.
 */
export function summarizeToolInput(name: string, input: unknown): string {
  if (!isRecord(input)) return "";
  if (name === "Grep" && typeof input.pattern === "string") {
    const grep =
      typeof input.path === "string" ? `${input.pattern} in ${input.path}` : input.pattern;
    return firstLine(grep, NAMED_SUMMARY_MAX);
  }
  for (const field of SUMMARY_FIELDS.get(name) ?? []) {
    const value = input[field];
    if (typeof value === "string") return firstLine(value, NAMED_SUMMARY_MAX);
  }
  const first = Object.values(input).find((value) => typeof value === "string");
  return typeof first === "string" ? firstLine(first, DEFAULT_SUMMARY_MAX) : "";
}
