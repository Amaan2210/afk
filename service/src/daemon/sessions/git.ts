import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const BRANCH_REF = /^ref: refs\/heads\/(.+)$/;
/** A full object id: SHA-1, or SHA-256 in a repository that uses it. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const GITDIR_LINE = /^gitdir:\s*(.+)$/m;

/**
 * The git directory of the repository holding `dir`: the nearest `.git` at or above it. A `.git`
 * file (worktree or submodule) names the real one with `gitdir:`, relative to the file's folder.
 */
async function findGitDir(dir: string): Promise<string | undefined> {
  for (;;) {
    const dotGit = path.join(dir, ".git");
    const info = await stat(dotGit).catch(() => undefined);
    if (info?.isDirectory()) return dotGit;
    if (info?.isFile()) {
      const line = GITDIR_LINE.exec(await readFile(dotGit, "utf8"));
      return line ? path.resolve(dir, line[1].trim()) : undefined;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The checked-out branch of the repository holding `cwd`, or the short SHA when HEAD is
 * detached; undefined outside a repository or on any error. Reads files only, never runs git.
 */
export async function currentBranch(cwd: string): Promise<string | undefined> {
  if (!path.isAbsolute(cwd)) return undefined;
  try {
    const gitDir = await findGitDir(cwd);
    if (gitDir === undefined) return undefined;
    const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    const branch = BRANCH_REF.exec(head);
    if (branch) return branch[1];
    return OBJECT_ID.test(head) ? head.slice(0, 7) : undefined;
  } catch {
    return undefined;
  }
}
