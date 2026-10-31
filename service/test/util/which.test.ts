import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOnPath } from "../../src/util/which.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "afk-which-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function withFiles(...names: string[]): string {
  const d = tmp();
  for (const n of names) writeFileSync(join(d, n), "");
  return d;
}

describe("findOnPath", () => {
  it("returns the first PATH directory with a match, trying PATHEXT in order", () => {
    const empty = tmp();
    const d = withFiles("tool.cmd", "tool.exe");
    const env = { PATH: `${empty};;${d}`, PATHEXT: ".EXE;.CMD" };
    expect(findOnPath("tool", { env, platform: "win32" })).toBe(join(d, "tool.exe"));
  });

  it("defaults PATHEXT and reads Path/PathExt case-insensitively on win32", () => {
    const d = withFiles("tool.bat");
    expect(findOnPath("tool", { env: { Path: d }, platform: "win32" })).toBe(join(d, "tool.bat"));
    const e = withFiles("tool.ps1");
    const env = { Path: e, PathExt: ".PS1" };
    expect(findOnPath("tool", { env, platform: "win32" })).toBe(join(e, "tool.ps1"));
  });

  it("falls back to the bare name on win32 when no extension matches", () => {
    const d = withFiles("tool");
    expect(findOnPath("tool", { env: { PATH: d }, platform: "win32" })).toBe(join(d, "tool"));
  });

  it("ignores directories that merely carry the executable's name", () => {
    const d = tmp();
    mkdirSync(join(d, "tool.exe"));
    expect(findOnPath("tool", { env: { PATH: d }, platform: "win32" })).toBeUndefined();
  });

  it("strips quotes from win32 PATH entries", () => {
    const d = withFiles("tool.exe");
    expect(findOnPath("tool", { env: { PATH: `"${d}"` }, platform: "win32" })).toBe(
      join(d, "tool.exe"),
    );
  });

  // Host paths carry a drive letter on Windows, which ':' would split, so this runs on POSIX CI.
  it.skipIf(process.platform === "win32")(
    "splits PATH on ':' and uses only the bare name elsewhere",
    () => {
      const d = withFiles("tool", "tool.exe");
      expect(findOnPath("tool", { env: { PATH: `/nonexistent:${d}` }, platform: "linux" })).toBe(
        join(d, "tool"),
      );
    },
  );

  it("skips directories under skipDirs but not siblings that share a prefix", () => {
    const root = tmp();
    const inside = join(root, "pkg", "bin");
    const sibling = join(root, "pkg2");
    mkdirSync(inside, { recursive: true });
    mkdirSync(sibling);
    writeFileSync(join(inside, "tool.exe"), "");
    writeFileSync(join(sibling, "tool.exe"), "");
    const env = { PATH: `${inside};${sibling}` };
    expect(findOnPath("tool", { env, platform: "win32", skipDirs: [join(root, "pkg")] })).toBe(
      join(sibling, "tool.exe"),
    );
  });
});
