import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSessionProfile } from "../../../src/daemon/sessions/profile.js";
import { shellArgs } from "../../../src/daemon/sessions/shell.js";

describe("renderSessionProfile", () => {
  const p = renderSessionProfile({
    sessionId: "s_x",
    port: 2350,
    nodeExe: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry: "D:\\Naya Repos\\afk\\service\\dist\\cli.js",
  });

  it("defines claude and codex functions that call afk exec with splatted args", () => {
    expect(p).toMatch(
      /function claude \{[\s\S]*& "C:\\Program Files\\nodejs\\node\.exe" "D:\\Naya Repos\\afk\\service\\dist\\cli\.js" exec claude @args/,
    );
    expect(p).toMatch(/function codex \{[\s\S]*exec codex @args/);
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
    expect(q).toContain('& "C:\\a``b\\node.exe" "D:\\`$HOME\\`"x`"\\cli.js" exec claude @args');
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
      "const e = process.env;\n" +
        "console.log('AFK ' + JSON.stringify([process.argv.slice(2), e.AFK_SESSION_ID, e.AFK_PORT]));\n",
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
});
