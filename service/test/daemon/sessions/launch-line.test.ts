import { buildLaunchLine } from "../../../src/daemon/sessions/launch-line.js";

describe("buildLaunchLine", () => {
  it("quotes the prompt and ends with CR", () =>
    expect(buildLaunchLine("claude", ["--dangerously-skip-permissions"], 'Fix "it"')).toBe(
      'claude --dangerously-skip-permissions "Fix `"it`""\r',
    ));

  it("codex and shell", () => {
    expect(buildLaunchLine("codex", [], undefined)).toBe("codex\r");
    expect(buildLaunchLine("shell", [], undefined)).toBeUndefined();
    expect(() => buildLaunchLine("shell", ["x"], undefined)).toThrow();
  });

  it("rejects shell args or a shell prompt as a bad request", () => {
    expect(() => buildLaunchLine("shell", [], "hi")).toThrow(/^bad_request:/);
    expect(() => buildLaunchLine("shell", ["x"])).toThrow(/^bad_request:/);
  });

  it("treats an empty prompt as no prompt", () => {
    expect(buildLaunchLine("claude", [], "")).toBe("claude\r");
    expect(buildLaunchLine("shell", [], "")).toBeUndefined();
  });

  it("leaves plain flags bare and quotes args with spaces, non-ASCII or PowerShell syntax", () => {
    expect(
      buildLaunchLine("claude", [
        "--model=opus",
        "--add-dir",
        "D:\\Naya Repos\\café",
        "@splat",
        "a,b",
        "--%",
        "",
      ]),
    ).toBe('claude --model=opus --add-dir "D:\\Naya Repos\\café" "@splat" "a,b" "--%" ""\r');
  });

  it("quotes a bare -- so PowerShell does not consume it as the end of parameters", () => {
    expect(buildLaunchLine("claude", ["--", "x"])).toBe('claude "--" x\r');
    expect(buildLaunchLine("claude", ["--model", "opus", "--", "-x"])).toBe(
      'claude --model opus "--" -x\r',
    );
  });

  it("escapes variables, backticks and typographic quotes in the prompt", () => {
    expect(buildLaunchLine("codex", [], "cost $5 `x` \u201Cq\u201D")).toBe(
      'codex "cost `$5 ``x`` `\u201Cq`\u201D"\r',
    );
  });

  it("encodes line breaks and other control characters so the line is submitted once", () => {
    const line = buildLaunchLine("claude", [], "one\r\ntwo\tthree\x1b")!;
    expect(line).toBe('claude "one`r`ntwo`tthree$([char]27)"\r');
    expect(line.slice(0, -1)).not.toMatch(/[\r\n]/);
  });
});
