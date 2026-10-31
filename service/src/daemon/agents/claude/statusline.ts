import type { Strip } from "../../../protocol/index.js";
import { isRecord } from "../../../util/is-record.js";

/**
 * Maps a Claude Code status-line payload to a strip. A field is included only when its source
 * value is present (and, for numbers, finite), so missing sections just leave keys out.
 * `thinking` is not in the payload; see the spec's "derive or omit", we omit it.
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
  put(strip, "contextUsedPct", context.used_percentage);
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

function section(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return isRecord(value) ? value : {};
}
