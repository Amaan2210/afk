import { isRecord } from "../../util/is-record.js";

/** Longest default summary before it is cut with an ellipsis. */
const DEFAULT_SUMMARY_MAX = 60;

/** The input field that summarises each known tool (Grep is handled separately). */
const SUMMARY_FIELD = new Map<string, string>([
  ["Bash", "command"],
  ["Edit", "file_path"],
  ["Write", "file_path"],
  ["Read", "file_path"],
  ["NotebookEdit", "file_path"],
  ["Glob", "pattern"],
  ["Agent", "description"],
  ["WebSearch", "query"],
  ["WebFetch", "url"],
]);

/** `text` cut to `max` characters with a trailing "…" when it is longer. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A one-line summary of a tool call's input for a chat tool card: the tool's telling field
 * (the command, the file, the search), else the input's first string value, shortened.
 */
export function summarizeToolInput(name: string, input: unknown): string {
  if (!isRecord(input)) return "";
  if (name === "Grep" && typeof input.pattern === "string") {
    return typeof input.path === "string" ? `${input.pattern} in ${input.path}` : input.pattern;
  }
  const field = SUMMARY_FIELD.get(name);
  const named = field === undefined ? undefined : input[field];
  if (typeof named === "string") return named;
  const first = Object.values(input).find((value) => typeof value === "string");
  return typeof first === "string" ? truncate(first, DEFAULT_SUMMARY_MAX) : "";
}
