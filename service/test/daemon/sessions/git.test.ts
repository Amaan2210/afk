import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBranch } from "../../../src/daemon/sessions/git.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "afk-git-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function repo(dir: string, head: string): Promise<void> {
  await mkdir(join(dir, ".git"), { recursive: true });
  await writeFile(join(dir, ".git", "HEAD"), head);
}

describe("currentBranch", () => {
  it("reads the branch from .git/HEAD", async () => {
    await repo(root, "ref: refs/heads/feat/service\n");
    expect(await currentBranch(root)).toBe("feat/service");
  });

  it("tolerates CRLF line endings", async () => {
    await repo(root, "ref: refs/heads/main\r\n");
    expect(await currentBranch(root)).toBe("main");
  });

  it("returns the short SHA for a detached HEAD", async () => {
    await repo(root, "615b4f5c0ffee615b4f5c0ffee615b4f5c0ffee6\n");
    expect(await currentBranch(root)).toBe("615b4f5");
  });

  it("finds the repository from a subfolder", async () => {
    await repo(root, "ref: refs/heads/main\n");
    const sub = join(root, "src", "deep");
    await mkdir(sub, { recursive: true });
    expect(await currentBranch(sub)).toBe("main");
  });

  it("follows an absolute gitdir file (worktree)", async () => {
    const gitDir = join(root, "main", ".git", "worktrees", "wt");
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/wt-branch\n");
    const wt = join(root, "wt");
    await mkdir(wt);
    await writeFile(join(wt, ".git"), `gitdir: ${gitDir.replace(/\\/g, "/")}\n`);
    expect(await currentBranch(wt)).toBe("wt-branch");
  });

  it("follows a relative gitdir file (submodule)", async () => {
    const gitDir = join(root, ".git", "modules", "lib");
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/sub\r\n");
    const lib = join(root, "lib");
    await mkdir(lib);
    await writeFile(join(lib, ".git"), "gitdir: ../.git/modules/lib\r\n");
    expect(await currentBranch(lib)).toBe("sub");
  });

  it("is undefined outside a repository", async () => {
    expect(await currentBranch(root)).toBeUndefined();
    expect(await currentBranch(join(root, "missing"))).toBeUndefined();
  });

  it("is undefined for an unrecognised HEAD", async () => {
    await repo(root, "garbage\n");
    expect(await currentBranch(root)).toBeUndefined();
  });

  it("stops at the nearest .git even when it is broken", async () => {
    await repo(root, "ref: refs/heads/main\n");
    const broken = join(root, "broken");
    await mkdir(broken);
    await writeFile(join(broken, ".git"), "not a gitdir line\n");
    expect(await currentBranch(broken)).toBeUndefined();
    const dangling = join(root, "dangling");
    await mkdir(dangling);
    await writeFile(join(dangling, ".git"), "gitdir: ./nowhere\n");
    expect(await currentBranch(dangling)).toBeUndefined();
  });

  it("is undefined for a relative path", async () => {
    expect(await currentBranch("relative\\dir")).toBeUndefined();
  });
});
