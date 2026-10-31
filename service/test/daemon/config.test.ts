import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { defaultConfigDir, afkPaths } from "../../src/daemon/paths.js";
import { loadConfig, saveConfig, readLocalToken } from "../../src/daemon/config.js";
import { verifyToken } from "../../src/daemon/tokens.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "afk-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("config", () => {
  it("loadConfig creates defaults and a local token on first run", async () => {
    const dir = tmp();
    const paths = afkPaths(dir);
    const cfg = await loadConfig(paths);
    expect(cfg.port).toBe(2350);
    expect(cfg.settings).toEqual({ keepAwake: true, keepAwakeGraceMin: 10, retentionHours: 24 });
    expect(verifyToken(await readLocalToken(paths), cfg.localTokenHash)).toBe(true);
    expect(existsSync(paths.configFile)).toBe(true);
  });

  it("saveConfig round-trips and a second loadConfig keeps the same local token", async () => {
    const paths = afkPaths(tmp());
    const cfg = await loadConfig(paths);
    await saveConfig(paths, { ...cfg, port: 2351 });
    const again = await loadConfig(paths);
    expect(again.port).toBe(2351);
    expect(again.localTokenHash).toBe(cfg.localTokenHash);
    expect(existsSync(paths.configFile + ".tmp")).toBe(false);
  });

  it("fills missing keys from defaults and keeps unknown keys", async () => {
    const paths = afkPaths(tmp());
    const cfg = await loadConfig(paths);
    writeFileSync(
      paths.configFile,
      JSON.stringify({
        localTokenHash: cfg.localTokenHash,
        settings: { keepAwake: false },
        extra: 1,
      }),
    );
    const again = (await loadConfig(paths)) as unknown as Record<string, unknown>;
    expect(again.port).toBe(2350);
    expect(again.settings).toEqual({ keepAwake: false, keepAwakeGraceMin: 10, retentionHours: 24 });
    expect(again.extra).toBe(1);
  });

  it("backs up a corrupt config and starts fresh", async () => {
    const paths = afkPaths(tmp());
    await loadConfig(paths);
    writeFileSync(paths.configFile, "{not json");
    const cfg = await loadConfig(paths);
    expect(cfg.port).toBe(2350);
    expect(readdirSync(paths.configDir).some((f) => f.startsWith("config.json.corrupt-"))).toBe(
      true,
    );
    expect(verifyToken(await readLocalToken(paths), cfg.localTokenHash)).toBe(true);
  });

  it("regenerates the local token when the token file is missing", async () => {
    const paths = afkPaths(tmp());
    const cfg = await loadConfig(paths);
    rmSync(paths.localTokenFile);
    const again = await loadConfig(paths);
    expect(again.localTokenHash).not.toBe(cfg.localTokenHash);
    expect(verifyToken(await readLocalToken(paths), again.localTokenHash)).toBe(true);
  });
});

describe("paths", () => {
  it("defaultConfigDir uses LOCALAPPDATA on win32 and ~/.config elsewhere", () => {
    expect(defaultConfigDir({ LOCALAPPDATA: "C:\\U\\x\\AppData\\Local" }, "win32")).toBe(
      "C:\\U\\x\\AppData\\Local\\afk",
    );
    expect(defaultConfigDir({ HOME: "/home/x" }, "linux")).toBe("/home/x/.config/afk");
  });

  it("defaultConfigDir falls back to USERPROFILE on win32", () => {
    expect(defaultConfigDir({ USERPROFILE: "C:\\U\\x" }, "win32")).toBe(
      "C:\\U\\x\\AppData\\Local\\afk",
    );
  });

  it("afkPaths derives all file locations from the config dir", () => {
    const p = afkPaths(join("a", "afk"));
    expect(p.configFile).toBe(join("a", "afk", "config.json"));
    expect(p.localTokenFile).toBe(join("a", "afk", "local-token"));
    expect(p.logDir).toBe(join("a", "afk", "logs"));
    expect(p.sessionsDir).toBe(join("a", "afk", "sessions"));
    expect(p.lockFile).toBe(join("a", "afk", "daemon.lock"));
  });
});
