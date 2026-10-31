import { summarizeToolInput } from "../../../src/daemon/agents/summarize.js";

describe("summarizeToolInput", () => {
  it.each([
    ["Bash", { command: "npm test" }, "npm test"],
    ["Edit", { file_path: "src/a.ts", old_string: "x" }, "src/a.ts"],
    ["Grep", { pattern: "session", path: "src/" }, "session in src/"],
    ["Grep", { pattern: "session" }, "session"],
    ["Agent", { subagent_type: "Explore", description: "find auth" }, "find auth"],
    ["Unknown", { foo: "a".repeat(80) }, "a".repeat(60) + "…"],
  ])("%s", (name, input, out) => expect(summarizeToolInput(name, input)).toBe(out));

  // The named field is never the first string value, so the default rule cannot pass these.
  it.each([
    ["Write", { content: "x", file_path: "src/b.ts" }, "src/b.ts"],
    ["Read", { mode: "x", file_path: "src/c.ts" }, "src/c.ts"],
    ["NotebookEdit", { new_source: "print(1)", notebook_path: "n.ipynb" }, "n.ipynb"],
    ["NotebookEdit", { new_source: "print(1)", file_path: "m.ipynb" }, "m.ipynb"],
    ["Glob", { path: "src", pattern: "**/*.ts" }, "**/*.ts"],
    ["WebSearch", { note: "x", query: "vitest waitFor" }, "vitest waitFor"],
    ["WebFetch", { prompt: "summarise", url: "https://example.com" }, "https://example.com"],
  ])("%s uses its named field", (name, input, out) =>
    expect(summarizeToolInput(name, input)).toBe(out),
  );

  it("caps every named summary to its first line and 120 characters", () => {
    const heredoc = "cat <<'EOF' > notes.md\nline one\nline two\nEOF";
    expect(summarizeToolInput("Bash", { command: heredoc })).toBe("cat <<'EOF' > notes.md…");
    expect(summarizeToolInput("Bash", { command: "npm test\r\nnpm run build" })).toBe("npm test…");
    expect(summarizeToolInput("Bash", { command: "x".repeat(500) })).toBe("x".repeat(120) + "…");
    expect(summarizeToolInput("Bash", { command: "x".repeat(120) })).toBe("x".repeat(120));
    expect(summarizeToolInput("Grep", { pattern: "p".repeat(200), path: "src/" })).toBe(
      "p".repeat(120) + "…",
    );
  });

  it("takes the first string value by default and does not truncate short ones", () => {
    expect(summarizeToolInput("Mystery", { n: 3, flag: true, note: "short", other: "x" })).toBe(
      "short",
    );
    expect(summarizeToolInput("Mystery", { s: "a".repeat(60) })).toBe("a".repeat(60));
    expect(summarizeToolInput("Mystery", { s: "first\nsecond" })).toBe("first…");
  });

  it("returns an empty string for non-object input or no string values", () => {
    for (const input of [undefined, null, "npm test", 42, ["a"]]) {
      expect(summarizeToolInput("Bash", input)).toBe("");
    }
    expect(summarizeToolInput("Mystery", { n: 1 })).toBe("");
  });
});
