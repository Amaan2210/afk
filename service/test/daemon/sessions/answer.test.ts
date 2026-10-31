import type { Pending } from "../../../src/protocol/index.js";
import { chunksForAnswer, keystrokesForAnswer } from "../../../src/daemon/sessions/answer.js";

const q: Pending = {
  kind: "question",
  id: "p1",
  text: "Cats or dogs?",
  multiSelect: false,
  allowsText: true,
  options: [{ label: "Cats" }, { label: "Dogs" }, { label: "Birds" }],
};
const multi: Pending = { ...q, multiSelect: true } as Pending;
const noText: Pending = { ...q, allowsText: false } as Pending;
const tenOptions: Pending = {
  ...q,
  options: Array.from({ length: 10 }, (_, i) => ({ label: `o${i}` })),
} as Pending;
const nineOptions: Pending = {
  ...q,
  options: Array.from({ length: 9 }, (_, i) => ({ label: `o${i}` })),
} as Pending;
const perm: Pending = { kind: "permission", id: "p2", tool: "Bash", summary: "echo hi" };

const DOWN = "\x1b[B";

const keys = (kind: "claude" | "codex" | "shell", p: Pending, a: object): string =>
  keystrokesForAnswer(kind, p, a).toString();
const chunks = (kind: "claude" | "codex", p: Pending, a: object): string[] =>
  chunksForAnswer(kind, p, a).map(String);

describe("keystrokesForAnswer", () => {
  it("Claude single-choice question → the digit alone (it selects and submits)", () =>
    expect(keys("claude", q, { choiceIndices: [1] })).toBe("2"));

  it("Claude permission allow/always → 1/2, deny → Esc (option 3 is not always No)", () => {
    expect(keys("claude", perm, { decision: "allow" })).toBe("1");
    expect(keys("claude", perm, { decision: "allow_always" })).toBe("2");
    expect(keys("claude", perm, { decision: "deny" })).toBe("\x1b");
  });

  it("free text → digit of the Type-something row, then text + Enter, as separate chunks", () => {
    expect(chunks("claude", q, { text: "Use cookies" })).toEqual(["4", "Use cookies\r"]);
    expect(keys("claude", q, { text: "Use cookies" })).toBe("4Use cookies\r");
  });

  it("rejects an out-of-range choice", () =>
    expect(() => keys("claude", q, { choiceIndices: [9] })).toThrow(/^bad_request:/));

  it("multi-select moves with Down, toggles with Space, Enter on Submit, then confirms", () => {
    // Cursor starts on option 0: toggle it, Down x2 to Birds and toggle, Down x2 to Submit, Enter.
    expect(chunks("claude", multi, { choiceIndices: [2, 0] })).toEqual([
      ` ${DOWN}${DOWN} ${DOWN}${DOWN}\r`,
      "\r",
    ]);
  });

  it("returns a UTF-8 Buffer", () =>
    expect(keystrokesForAnswer("claude", q, { text: "é" })).toEqual(Buffer.from("4é\r", "utf8")));

  it("Codex permission → y / a / n", () => {
    expect(keys("codex", perm, { decision: "allow" })).toBe("y");
    expect(keys("codex", perm, { decision: "allow_always" })).toBe("a");
    expect(keys("codex", perm, { decision: "deny" })).toBe("n");
  });

  it("Codex question behaves like Claude's", () =>
    expect(keys("codex", q, { choiceIndices: [2] })).toBe("3"));

  it("the ninth option (index 8) is addressable by digit", () =>
    expect(keys("claude", nineOptions, { choiceIndices: [8] })).toBe("9"));

  it("multi-select without the Type-something row submits right after the options", () =>
    expect(
      chunks("claude", { ...multi, allowsText: false } as Pending, { choiceIndices: [0] }),
    ).toEqual([` ${DOWN}${DOWN}${DOWN}\r`, "\r"]));

  it("keeps non-ASCII text", () => expect(keys("claude", q, { text: "café ✓" })).toBe("4café ✓\r"));

  it("shell sessions have no prompts", () =>
    expect(() => keys("shell", q, { choiceIndices: [0] })).toThrow(/^bad_request:/));

  it.each([
    ["both choice and text", q, { choiceIndices: [0], text: "x" }],
    ["neither", q, {}],
    ["decision on a question", q, { decision: "allow" }],
    ["choiceIndices on a permission", perm, { choiceIndices: [0] }],
    ["text on a permission", perm, { text: "x" }],
    ["permission without decision", perm, {}],
    ["multiple indices on single-select", q, { choiceIndices: [0, 1] }],
    ["negative index", q, { choiceIndices: [-1] }],
    ["non-integer index", q, { choiceIndices: [0.5] }],
    ["empty indices", q, { choiceIndices: [] }],
    ["duplicate indices on multi-select", multi, { choiceIndices: [1, 1] }],
    ["a tenth option picked by digit", tenOptions, { choiceIndices: [9] }],
    ["free text on a question with nine options or more", tenOptions, { text: "x" }],
    ["text when allowsText is false", noText, { text: "x" }],
    ["free text on a multi-select question", multi, { text: "x" }],
    ["empty text", q, { text: "" }],
    ["whitespace-only text", q, { text: "  " }],
    ["text with a newline", q, { text: "a" + String.fromCharCode(10) + "b" }],
    ["text with an escape", q, { text: "a" + String.fromCharCode(27) + "b" }],
    ["text with DEL", q, { text: "a" + String.fromCharCode(127) }],
    ["an unknown decision", perm, { decision: "maybe" }],
  ])("rejects %s", (_name, p, a) => expect(() => keys("claude", p, a)).toThrow(/^bad_request:/));
});
