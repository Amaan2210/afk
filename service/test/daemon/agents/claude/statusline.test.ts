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
