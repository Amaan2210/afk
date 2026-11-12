import { mapStatusline } from "../../../../src/daemon/agents/claude/statusline.js";
import { readFixtureJson } from "../../../helpers/fixtures.js";

describe("mapStatusline", () => {
  it("extracts the strip", () => {
    const at = "2026-10-30T14:00:00.000Z";
    expect(mapStatusline(readFixtureJson("claude/statusline.json"), at)).toEqual({
      at,
      model: { id: "claude-fable-5-1", name: "Fable 5.1" },
      contextUsedPct: 11,
      contextSize: 200000,
      costUsd: 3.6,
      durationMs: 1920000,
      fiveHourPct: 38,
      sevenDayPct: 12.5,
      tokensIn: 1200000,
      tokensOut: 32800,
    });
  });

  it("tolerates missing sections", () =>
    expect(mapStatusline({ model: { id: "x", display_name: "X" } }, "t")).toEqual({
      at: "t",
      model: { id: "x", name: "X" },
    }));

  it("tolerates garbage and defaults `at` to now", () => {
    const strip = mapStatusline("nope");
    expect(Object.keys(strip)).toEqual(["at"]);
    expect(Number.isNaN(Date.parse(strip.at))).toBe(false);
  });
});

describe("mapStatusline: thinking and the context fallback", () => {
  it("reads the effort level as the thinking chip", () => {
    expect(mapStatusline({ effort: { level: "high" }, thinking: { enabled: true } }).thinking).toBe(
      "think high",
    );
    expect(mapStatusline({ thinking: { enabled: true } }).thinking).toBe("think on");
    expect(
      mapStatusline({ effort: { level: "high" }, thinking: { enabled: false } }).thinking,
    ).toBe("think off");
    expect(mapStatusline({}).thinking).toBeUndefined();
  });

  it("works the context share out from the latest usage while Claude reports none", () => {
    const context_window = {
      context_window_size: 200000,
      used_percentage: null,
      current_usage: {
        input_tokens: 8500,
        output_tokens: 1200,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 2000,
      },
    };
    expect(mapStatusline({ context_window }).contextUsedPct).toBe(7.8);
    expect(
      mapStatusline({ context_window: { ...context_window, used_percentage: 11 } }).contextUsedPct,
    ).toBe(11);
    expect(
      mapStatusline({ context_window: { context_window_size: 200000, current_usage: null } })
        .contextUsedPct,
    ).toBeUndefined();
  });
});
