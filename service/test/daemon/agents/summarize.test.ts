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

  it.each([
    ["Write", { file_path: "src/b.ts", content: "x" }, "src/b.ts"],
    ["Read", { file_path: "src/c.ts" }, "src/c.ts"],
    ["NotebookEdit", { file_path: "n.ipynb", new_source: "x" }, "n.ipynb"],
    ["Glob", { pattern: "**/*.ts" }, "**/*.ts"],
    ["WebSearch", { query: "vitest waitFor" }, "vitest waitFor"],
    ["WebFetch", { url: "https://example.com", prompt: "summarise" }, "https://example.com"],
  ])("%s uses its named field", (name, input, out) =>
    expect(summarizeToolInput(name, input)).toBe(out),
  );

  it("takes the first string value by default and does not truncate short ones", () => {
    expect(summarizeToolInput("Mystery", { n: 3, flag: true, note: "short", other: "x" })).toBe(
      "short",
    );
    expect(summarizeToolInput("Mystery", { s: "a".repeat(60) })).toBe("a".repeat(60));
  });

  it("returns an empty string for non-object input or no string values", () => {
    for (const input of [undefined, null, "npm test", 42, ["a"]]) {
      expect(summarizeToolInput("Bash", input)).toBe("");
    }
    expect(summarizeToolInput("Mystery", { n: 1 })).toBe("");
  });
});
