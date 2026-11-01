import { formatAge, formatSessionTable, pairPayload, renderQr } from "../../src/cli/format.js";
import type { Session } from "../../src/protocol/index.js";

const NOW = new Date("2026-11-01T12:00:00.000Z");

function session(over: Partial<Session>): Session {
  return {
    id: "s_aaaaaaaaaaaa",
    name: "api",
    cwd: "/w/api",
    kind: "claude",
    state: "working",
    createdAt: "2026-11-01T11:30:00.000Z",
    lastActivityAt: "2026-11-01T11:59:00.000Z",
    subagentsRunning: 0,
    ...over,
  };
}

describe("formatAge", () => {
  it.each([
    ["2026-11-01T11:59:50.000Z", "10s"],
    ["2026-11-01T11:30:00.000Z", "30m"],
    ["2026-11-01T09:00:00.000Z", "3h"],
    ["2026-10-29T12:00:00.000Z", "3d"],
    ["2026-11-01T12:00:05.000Z", "0s"],
  ])("%s is %s", (from, text) => expect(formatAge(from, NOW)).toBe(text));
});

describe("formatSessionTable", () => {
  it("aligns columns and shortens LAST to 40 chars", () => {
    const long = "x".repeat(60);
    const out = formatSessionTable(
      [
        session({ lastMessage: long, gitBranch: "main" }),
        session({ id: "s_bbbbbbbbbbbb", name: "a-much-longer-name", kind: "codex" }),
      ],
      NOW,
    );
    const lines = out.split("\n");
    expect(lines[0]?.split(/\s+/)).toEqual([
      "ID",
      "NAME",
      "KIND",
      "STATE",
      "AGE",
      "BRANCH",
      "LAST",
    ]);
    expect(lines).toHaveLength(3);
    // Every column starts at the same offset on every row.
    const col = (line: string, word: string): number => line.indexOf(word);
    expect(col(lines[1] ?? "", "claude")).toBe(col(lines[0] ?? "", "KIND"));
    expect(col(lines[2] ?? "", "codex")).toBe(col(lines[0] ?? "", "KIND"));
    expect(lines[1]).toContain("x".repeat(39) + "…");
    expect(lines[1]).not.toContain("x".repeat(40));
    expect(lines[1]?.trimEnd()).toBe(lines[1]); // no trailing padding
  });

  it("shows a dash for a missing branch and message, and collapses newlines", () => {
    const out = formatSessionTable([session({ lastMessage: "a\nb" })], NOW).split("\n")[1] ?? "";
    expect(out).toContain("a b");
    expect(formatSessionTable([session({})], NOW).split("\n")[1]).toMatch(/-\s+-$/);
  });

  it("says so when there are no sessions", () => {
    expect(formatSessionTable([], NOW)).toBe("No sessions.");
  });
});

describe("pairPayload", () => {
  it("uses the Tailscale ip and port from hello", () =>
    expect(pairPayload({ daemon: { tailscaleIp: "100.84.12.9" } }, "tok")).toEqual({
      afk: 1,
      host: "100.84.12.9",
      port: 2350,
      token: "tok",
    }));

  it("takes the port it connected on", () =>
    expect(pairPayload({ daemon: { tailscaleIp: "100.1.1.1" } }, "t", 4000).port).toBe(4000));

  it("throws without a Tailscale ip", () =>
    expect(() => pairPayload({ daemon: {} }, "t")).toThrow(/Tailscale/));
});

describe("renderQr", () => {
  it("renders a multi-line block", () => {
    const qr = renderQr({ afk: 1, host: "100.1.1.1", port: 2350, token: "t" });
    expect(qr.split("\n").length).toBeGreaterThan(5);
  });
});
