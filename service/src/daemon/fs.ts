import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DirListing {
  path?: string;
  parent?: string;
  dirs: { name: string; path: string }[];
  recent: string[];
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Most-recently-used working folders, persisted as a JSON array of paths.
 * Two instances on one file are not coordinated; the daemon uses a single instance.
 */
export class RecentFolders {
  private readonly win32 = process.platform === "win32";
  private queue: Promise<void> = Promise.resolve();
  private writes = 0;

  constructor(
    private readonly file: string,
    private readonly max = 10,
  ) {}

  private key(p: string): string {
    const trimmed = p.replace(/[\\/]+$/, "");
    return this.win32 ? trimmed.toLowerCase() : trimmed;
  }

  async add(folder: string): Promise<void> {
    // Serialise so concurrent adds cannot lose updates.
    const run = this.queue.then(async () => {
      const entry = path.normalize(folder);
      const rest = (await this.read()).filter((p) => this.key(p) !== this.key(entry));
      await this.write([entry, ...rest].slice(0, this.max));
    });
    this.queue = run.catch(() => undefined);
    await run;
  }

  /** Remembered folders, newest first, limited to those that still exist. Does not rewrite the file. */
  async list(): Promise<string[]> {
    const all = await this.read();
    const exists = await Promise.all(all.map(isDirectory));
    return all.filter((_, i) => exists[i]);
  }

  private async read(): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  private async write(list: string[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${this.writes++}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(list, null, 2));
      await rename(tmp, this.file);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
}

async function driveRoots(): Promise<{ name: string; path: string }[]> {
  const roots = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`);
  const present = await Promise.all(roots.map(isDirectory));
  return roots.filter((_, i) => present[i]).map((r) => ({ name: r, path: r }));
}

/**
 * Lists the visible sub-folders of `dir`; with no `dir`, the drive roots (win32) or "/".
 * Hidden detection is name-based only (leading "."); Windows hidden/system attributes are not read (v1).
 */
export async function listDirs(
  dir: string | undefined,
  recent: RecentFolders,
  platform: NodeJS.Platform = process.platform,
): Promise<DirListing> {
  if (dir !== undefined && !path.isAbsolute(dir))
    throw new Error("bad_request: path must be absolute");
  const recentList = await recent.list();
  if (dir === undefined) {
    const dirs = platform === "win32" ? await driveRoots() : [{ name: "/", path: "/" }];
    return { dirs, recent: recentList };
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error(`not_found: ${dir} is not a readable folder`);
  }
  const dirs: { name: string; path: string }[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    // withFileTypes reports symlinks/junctions as non-directories; resolve them.
    if (e.isDirectory() || (e.isSymbolicLink() && (await isDirectory(full)))) {
      dirs.push({ name: e.name, path: full });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const parent = path.dirname(dir);
  return { path: dir, ...(parent === dir ? {} : { parent }), dirs, recent: recentList };
}
