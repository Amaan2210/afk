import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLaunchLine } from "../../../src/daemon/sessions/launch-line.js";
import { renderSessionProfile } from "../../../src/daemon/sessions/profile.js";
import { shellArgs } from "../../../src/daemon/sessions/shell.js";

describe("renderSessionProfile", () => {
  const p = renderSessionProfile({
    sessionId: "s_x",
    port: 2350,
    nodeExe: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry: "D:\\Naya Repos\\afk\\service\\dist\\cli.js",
  });

  it("defines claude and codex functions that call afk exec with the forwarded args", () => {
    expect(p).toMatch(
      /function claude \{[^\n]*& "C:\\Program Files\\nodejs\\node\.exe" "D:\\Naya Repos\\afk\\service\\dist\\cli\.js" exec claude @afkArgs \}/,
    );
    expect(p).toMatch(/function codex \{[^\n]*exec codex @afkArgs \}/);
    expect(p).toContain("function claude { $afkArgs = @(afk-forward-args $args); & ");
    expect(p).toContain("function codex { $afkArgs = @(afk-forward-args $args); & ");
  });

  it("defines the argument-forwarding helper once, in Windows PowerShell 5.1 syntax", () => {
    expect(p.match(/^function afk-forward-args \{/gm)).toHaveLength(1);
    expect(p).toContain("PSNativeCommandArgumentPassing");
    expect(p).not.toMatch(/&&|\|\||\?\?/);
  });

  it("exports session env vars", () => {
    expect(p).toContain(`$env:AFK_SESSION_ID = "s_x"`);
    expect(p).toContain(`$env:AFK_PORT = "2350"`);
  });

  it("does not dot-source or modify the user's profile", () => {
    expect(p).not.toMatch(/\$PROFILE/);
  });

  it("titles the window without failing on non-console hosts and prints the detach hint", () => {
    expect(p).toContain(`try { $Host.UI.RawUI.WindowTitle = "afk · s_x" } catch {}`);
    expect(p).toContain(
      `Write-Host "afk session s_x · detach: Ctrl+] d" -ForegroundColor DarkGray`,
    );
  });

  it("starts with a byte order mark so Windows PowerShell 5.1 reads it as UTF-8", () => {
    expect(p.charCodeAt(0)).toBe(0xfeff);
  });

  it("escapes backticks, dollars and double quotes inside PowerShell strings", () => {
    const q = renderSessionProfile({
      sessionId: "s_y",
      port: 1,
      nodeExe: "C:\\a`b\\node.exe",
      cliEntry: 'D:\\$HOME\\"x"\\cli.js',
    });
    expect(q).toContain('& "C:\\a``b\\node.exe" "D:\\`$HOME\\`"x`"\\cli.js" exec claude @afkArgs');
  });

  it("removes aliases that would shadow the session functions, right before defining them", () => {
    const lines = p.split("\r\n");
    const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix));
    expect(lines).toContain(
      "Remove-Item Alias:claude,Alias:codex -Force -ErrorAction SilentlyContinue",
    );
    expect(at("$env:AFK_PORT")).toBeLessThan(at("Remove-Item Alias:"));
    expect(at("Remove-Item Alias:") + 1).toBe(at("function claude"));
    expect(at("function claude") + 1).toBe(at("function codex"));
  });
});

describe.skipIf(process.platform !== "win32")("session profile under Windows PowerShell", () => {
  const echoArgv = 'AFK [["exec","claude","--print","say hi"],"s_t","2351"]';
  let root = "";
  let profile = "";

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "afk-profile-"));
    const dir = join(root, "café dir");
    mkdirSync(dir);
    const cliEntry = join(dir, "cli.js");
    writeFileSync(
      cliEntry,
      [
        "const e = process.env;",
        "const out = JSON.stringify([process.argv.slice(2), e.AFK_SESSION_ID, e.AFK_PORT]);",
        // Non-ASCII leaves as JSON escapes so no console code page can alter what node received.
        "const ascii = out.replace(/[^ -~]/g, (c) => '\\\\' + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));",
        "console.log('AFK ' + ascii);",
      ].join("\n"),
    );
    profile = join(dir, "profile.ps1");
    writeFileSync(
      profile,
      renderSessionProfile({ sessionId: "s_t", port: 2351, nodeExe: process.execPath, cliEntry }),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs with a non-ASCII path containing spaces", () => {
    const r = spawnSync("powershell.exe", ["-NoProfile", ...shellArgs(profile)], {
      input: "claude --print 'say hi'\r\nexit\r\n",
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.stdout).toContain(echoArgv);
  }, 40_000);

  it("wins over a claude alias the user's profile defined first", () => {
    // Stands in for the user's profile, which shellArgs lets load before the session profile.
    const script = `Set-Alias claude Get-Date; . '${profile.replace(/'/g, "''")}'; claude --print 'say hi'`;
    const r = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(r.stdout).toContain(echoArgv);
  }, 40_000);

  it("forwards each typed argument to node exactly", () => {
    // [typed at the prompt, argv node must receive after `exec`]
    const cases: Array<[string, string[]]> = [
      ['claude "Fix `"it`""', ["claude", 'Fix "it"']],
      ['claude "" x', ["claude", "", "x"]],
      ['claude --add-dir "D:\\Naya Repos\\" y', ["claude", "--add-dir", "D:\\Naya Repos\\", "y"]],
      ['claude "D:\\Naya Repos\\café"', ["claude", "D:\\Naya Repos\\café"]],
      // PowerShell's parser drops a bare -- before any function runs; launch lines quote it.
      ['claude "--" x', ["claude", "--", "x"]],
      ["claude --model opus", ["claude", "--model", "opus"]],
      // PowerShell 5.1 would not quote these itself: every space follows an odd number of `"`.
      [`claude 'a\\"b c'`, ["claude", 'a\\"b c']],
      [`claude '"Fix it"'`, ["claude", '"Fix it"']],
      // No whitespace, so PowerShell never quotes these.
      [`claude 'a"b' 'D:\\x\\' z`, ["claude", 'a"b', "D:\\x\\", "z"]],
      [`codex exec 'D:\\a b\\'`, ["codex", "exec", "D:\\a b\\"]],
    ];
    // An encoded command is UTF-16, so the non-ASCII case reaches PowerShell intact.
    const script = [`. '${profile.replace(/'/g, "''")}'`, ...cases.map(([typed]) => typed)];
    const encoded = Buffer.from(script.join("\r\n"), "utf16le").toString("base64");
    const r = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { encoding: "utf8", timeout: 30_000 },
    );
    const got = receivedArgv(r.stdout);
    expect(cases.map(([typed], i) => [typed, got[i]])).toEqual(
      cases.map(([typed, argv]) => [typed, ["exec", ...argv]]),
    );
  }, 40_000);

  it("delivers the launch line a new session types intact", () => {
    const line = buildLaunchLine("claude", ["--dangerously-skip-permissions"], 'Fix "it"')!;
    const r = spawnSync("powershell.exe", ["-NoProfile", ...shellArgs(profile)], {
      input: `${line}exit\r`,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(receivedArgv(r.stdout)).toEqual([
      ["exec", "claude", "--dangerously-skip-permissions", 'Fix "it"'],
    ]);
  }, 40_000);
});

/** The argv (from `exec` on) of each call the echo script recorded. */
function receivedArgv(stdout: string): string[][] {
  return (
    stdout
      // PowerShell echoes typed lines, and a launch line ends in a bare CR.
      .split(/\r\n|\r|\n/)
      .filter((l) => l.startsWith("AFK "))
      .map((l) => (JSON.parse(l.slice(4)) as [string[], string, string])[0])
  );
}
