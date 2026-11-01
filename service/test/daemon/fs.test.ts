import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RecentFolders, listDirs } from "../../src/daemon/fs.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "afk-fs-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function dirs(...names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const n of names) {
    const p = path.join(tmp, n);
    await mkdir(p, { recursive: true });
    out.push(p);
  }
  return out;
}

describe("listDirs", () => {
  it("returns sorted visible dirs and parent", async () => {
    const root = path.join(tmp, "root");
    await mkdir(path.join(root, "b"), { recursive: true });
    await mkdir(path.join(root, "a"));
    await mkdir(path.join(root, "C"));
    await mkdir(path.join(root, ".hidden"));
    await writeFile(path.join(root, "file.txt"), "x");
    const recent = new RecentFolders(path.join(tmp, "recent.json"));
    const res = await listDirs(root, recent);
    expect(res.path).toBe(root);
    expect(res.parent).toBe(path.dirname(root));
    expect(res.dirs).toEqual([
      { name: "a", path: path.join(root, "a") },
      { name: "b", path: path.join(root, "b") },
      { name: "C", path: path.join(root, "C") },
    ]);
    expect(res.recent).toEqual([]);
  });

  it("includes recent folders", async () => {
    const [a] = await dirs("a");
    const recent = new RecentFolders(path.join(tmp, "recent.json"));
    await recent.add(a!);
    expect((await listDirs(tmp, recent)).recent).toEqual([a]);
  });

  it("a root path has no parent", async () => {
    const root = path.parse(tmp).root;
    const res = await listDirs(root, new RecentFolders(path.join(tmp, "r.json")));
    expect(res.parent).toBeUndefined();
  });

  it("throws not_found for a missing path", async () => {
    const recent = new RecentFolders(path.join(tmp, "r.json"));
    await expect(listDirs(path.join(tmp, "nope"), recent)).rejects.toThrow(/^not_found:/);
  });

  it("throws not_found for a file path", async () => {
    const f = path.join(tmp, "f.txt");
    await writeFile(f, "x");
    const recent = new RecentFolders(path.join(tmp, "r.json"));
    await expect(listDirs(f, recent)).rejects.toThrow(/^not_found:/);
  });

  it.runIf(process.platform === "win32")("undefined path lists existing drive roots", async () => {
    const res = await listDirs(undefined, new RecentFolders(path.join(tmp, "r.json")), "win32");
    expect(res.path).toBeUndefined();
    expect(res.parent).toBeUndefined();
    const sysDrive = path.parse(tmp).root.toUpperCase();
    const paths = res.dirs.map((d) => d.path);
    expect(paths).toContain(sysDrive);
    expect(res.dirs.every((d) => /^[A-Z]:\\$/.test(d.path) && d.name === d.path)).toBe(true);
    expect([...paths].sort()).toEqual(paths);
  });

  it("throws bad_request for a relative path", async () => {
    const recent = new RecentFolders(path.join(tmp, "r.json"));
    await expect(listDirs("relative/dir", recent)).rejects.toThrow(/^bad_request:/);
  });

  it("throws bad_request for UNC and device paths without reading them", async () => {
    const recent = new RecentFolders(path.join(tmp, "r.json"));
    for (const p of ["\\\\server\\share", "\\\\.\\pipe\\x", "//server/share", "\\rooted"]) {
      await expect(listDirs(p, recent)).rejects.toThrow(
        "bad_request: network and device paths are not supported",
      );
    }
  });

  it("undefined path on non-win32 lists the filesystem root", async () => {
    const res = await listDirs(undefined, new RecentFolders(path.join(tmp, "r.json")), "linux");
    expect(res.dirs).toEqual([{ name: "/", path: "/" }]);
  });
});

describe("RecentFolders", () => {
  it("is most-recent-first, deduped, capped", async () => {
    const [a, b, c] = await dirs("a", "b", "c");
    const r = new RecentFolders(path.join(tmp, "recent.json"), 2);
    await r.add(a!);
    await r.add(b!);
    await r.add(a!);
    expect(await r.list()).toEqual([a, b]);
    await r.add(c!);
    expect(await r.list()).toEqual([c, a]);
  });

  it.runIf(process.platform === "win32")("dedupes case-insensitively on win32", async () => {
    const [a] = await dirs("Abc");
    const r = new RecentFolders(path.join(tmp, "recent.json"));
    await r.add(a!);
    await r.add(a!.toUpperCase());
    expect(await r.list()).toHaveLength(1);
  });

  it("dedupes a path with and without a trailing separator", async () => {
    const [a] = await dirs("a");
    const r = new RecentFolders(path.join(tmp, "recent.json"));
    await r.add(a! + path.sep);
    await r.add(a!);
    expect(await r.list()).toEqual([path.normalize(a!)]);
  });

  it("keeps every entry across concurrent adds", async () => {
    const names = ["a", "b", "c", "d", "e"];
    const made = await dirs(...names);
    const r = new RecentFolders(path.join(tmp, "recent.json"));
    await Promise.all(made.map((d) => r.add(d)));
    expect((await r.list()).sort()).toEqual([...made].sort());
    expect(await readdir(tmp)).not.toContain(expect.stringMatching(/.tmp$/));
  });

  it("filters folders that no longer exist without rewriting the file", async () => {
    const [a, b] = await dirs("a", "b");
    const file = path.join(tmp, "recent.json");
    const r = new RecentFolders(file);
    await r.add(a!);
    await r.add(b!);
    await rm(a!, { recursive: true });
    const before = await readFile(file, "utf8");
    expect(await r.list()).toEqual([b]);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(JSON.parse(before)).toHaveLength(2);
  });

  it("treats a missing or corrupt file as empty and persists across instances", async () => {
    const [a] = await dirs("a");
    const file = path.join(tmp, "recent.json");
    expect(await new RecentFolders(file).list()).toEqual([]);
    await writeFile(file, "{not json");
    expect(await new RecentFolders(file).list()).toEqual([]);
    await new RecentFolders(file).add(a!);
    expect(await new RecentFolders(file).list()).toEqual([a]);
  });

  it("writes atomically: no temp files left behind", async () => {
    const [a] = await dirs("a");
    const sub = path.join(tmp, "state");
    const r = new RecentFolders(path.join(sub, "recent.json"));
    await r.add(a!);
    expect(await readdir(sub)).toEqual(["recent.json"]);
  });
});
