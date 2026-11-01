import type { Command } from "commander";

// Loading either would undo the point of src/cli/program.ts: every hook starts this CLI.
vi.mock("../../src/daemon/index.js", () => {
  throw new Error("the daemon was loaded");
});
vi.mock("../../src/cli/client.js", () => {
  throw new Error("the daemon client was loaded");
});

describe("the afk program", () => {
  it("is built without loading the daemon or its client", async () => {
    const { buildProgram } = await import("../../src/cli/program.js");
    const names = buildProgram().commands.map((c: Command) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["daemon", "claude", "attach", "service", "hook", "statusline"]),
    );
  });
});
