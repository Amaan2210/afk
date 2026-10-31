import { mapCodexNotify } from "../../../../src/daemon/agents/codex/notify.js";
import { readFixtureJson } from "../../../helpers/fixtures.js";

describe("mapCodexNotify", () => {
  it("maps agent-turn-complete to turn_end and the thread id", () => {
    expect(mapCodexNotify(readFixtureJson("codex/notify.json"))).toEqual({
      signals: [{ kind: "turn_end", lastMessage: "Done. Want me to commit?" }],
      meta: { agentSessionId: "thread-1" },
    });
  });

  it("omits lastMessage and the session id when they are not strings", () => {
    expect(
      mapCodexNotify({
        type: "agent-turn-complete",
        "thread-id": 7,
        "last-assistant-message": null,
      }),
    ).toEqual({ signals: [{ kind: "turn_end" }] });
  });

  it.each([
    ["an unknown type", { type: "approval-requested", "thread-id": "x" }],
    ["no type", {}],
    ["null", null],
    ["a string", "agent-turn-complete"],
    ["an array", []],
    ["undefined", undefined],
  ])("returns no signals for %s", (_name, payload) => {
    expect(mapCodexNotify(payload)).toEqual({ signals: [] });
  });
});
