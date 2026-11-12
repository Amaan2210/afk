import type { Strip } from "../../../protocol/index.js";
import { isRecord } from "../../../util/is-record.js";

/**
 * Maps a Claude Code status-line payload to a strip. A field is included only when its source
 * value is present (and, for numbers, finite), so missing sections just leave keys out.
 * `thinking` is the session's effort level, or whether extended thinking is on. The share of the
 * context in use is null early in a session; it is then worked out from the latest usage.
 */
export function mapStatusline(payload: unknown, at: string = new Date().toISOString()): Strip {
  const root = isRecord(payload) ? payload : {};
  const model = section(root, "model");
  const context = section(root, "context_window");
  const cost = section(root, "cost");
  const limits = section(root, "rate_limits");
  const strip: Strip = { at };
  if (typeof model.id === "string" && typeof model.display_name === "string") {
    strip.model = { id: model.id, name: model.display_name };
  }
  put(strip, "contextUsedPct", context.used_percentage ?? usedFromUsage(context));
  const thinking = thinkingOf(root);
  if (thinking !== undefined) strip.thinking = thinking;
  put(strip, "contextSize", context.context_window_size);
  put(strip, "costUsd", cost.total_cost_usd);
  put(strip, "durationMs", cost.total_duration_ms);
  put(strip, "fiveHourPct", section(limits, "five_hour").used_percentage);
  put(strip, "sevenDayPct", section(limits, "seven_day").used_percentage);
  put(strip, "tokensIn", context.total_input_tokens);
  put(strip, "tokensOut", context.total_output_tokens);
  return strip;
}

type NumericKey =
  | "contextUsedPct"
  | "contextSize"
  | "costUsd"
  | "durationMs"
  | "fiveHourPct"
  | "sevenDayPct"
  | "tokensIn"
  | "tokensOut";

function put(strip: Strip, key: NumericKey, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) strip[key] = value;
}

/** `think high`, from the effort level; `think on` or `think off` when only the switch is known. */
function thinkingOf(root: Record<string, unknown>): string | undefined {
  const enabled = section(root, "thinking").enabled;
  const level = section(root, "effort").level;
  if (enabled === false) return "think off";
  if (typeof level === "string" && level !== "") return `think ${level}`;
  return enabled === true ? "think on" : undefined;
}

/** The context in use as Claude Code counts it: the input side of the latest request. */
function usedFromUsage(context: Record<string, unknown>): number | undefined {
  const usage = section(context, "current_usage");
  const size = context.context_window_size;
  const parts = [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
  ].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (parts.length === 0 || typeof size !== "number" || size <= 0) return undefined;
  const used = parts.reduce((a, b) => a + b, 0);
  return Math.min(100, Math.round((used / size) * 1000) / 10);
}

function section(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return isRecord(value) ? value : {};
}
