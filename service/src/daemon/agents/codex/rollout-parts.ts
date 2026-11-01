// Parts of a rollout line that `rollout.ts` reads: message text, tool arguments and tool outputs.
import { isRecord } from "../../../util/is-record.js";
import { firstLine, summarizeToolInput } from "../summarize.js";

const SHELL_TOOL = "shell";
/** Longest tool card summary. */
const SUMMARY_MAX = 120;

type Record_ = Record<string, unknown>;

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The non-blank text of a message's `input_text` / `output_text` blocks, joined by a blank line. */
export function joinText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .filter(isRecord)
    .filter(
      (b) => (b.type === "input_text" || b.type === "output_text") && typeof b.text === "string",
    )
    .map((b) => b.text as string)
    .filter((text) => text.trim() !== "");
  return texts.length > 0 ? texts.join("\n\n") : undefined;
}

/**
 * A tool call's arguments as a card summary and the raw input text. A string is parsed as JSON; one
 * that is not a JSON object (an `apply_patch` patch, say) is summarised by its own first line. An
 * object is taken as already-parsed arguments.
 */
export function describeArgs(name: string, args: unknown): { summary: string; raw?: string } {
  if (typeof args === "string") {
    const parsed = parseObject(args);
    return {
      summary: parsed ? summarizeArgs(name, parsed) : firstLine(args, SUMMARY_MAX),
      raw: args,
    };
  }
  if (isRecord(args)) return { summary: summarizeArgs(name, args), raw: JSON.stringify(args) };
  return { summary: "" };
}

function parseObject(text: string): Record_ | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The shell command joined by spaces (first line only), else the generic input summary. */
function summarizeArgs(name: string, args: Record_): string {
  const command = args.command;
  if (
    name === SHELL_TOOL &&
    Array.isArray(command) &&
    command.every((p) => typeof p === "string")
  ) {
    return firstLine(command.join(" "), SUMMARY_MAX);
  }
  return summarizeToolInput(name, args);
}

/** A tool output as text: a string as is, an object's string `content`, else its JSON. */
export function outputText(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (isRecord(output) && typeof output.content === "string") return output.content;
  return JSON.stringify(output);
}

/** Only an output object that says so is an error: `success: false` or a non-zero `exit_code`. */
export function failed(output: unknown): boolean {
  if (!isRecord(output)) return false;
  return output.success === false || (isNumber(output.exit_code) && output.exit_code !== 0);
}
