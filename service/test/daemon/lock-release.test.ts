import * as fsp from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../../src/daemon/lock.js";

// Only the rm a test arms fails; everything else uses the real file system.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm) };
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-lock-release-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("releasing the lock", () => {
  it("frees it even when the pid file cannot be removed", async () => {
    const lockFile = join(dir, "daemon.lock");
    const release = await acquireLock(lockFile);
    const denied = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    vi.mocked(fsp.rm).mockRejectedValueOnce(denied);

    await expect(release()).rejects.toThrow("EPERM");
    // The endpoint is the lock: it must be free for the next daemon.
    const again = await acquireLock(lockFile);
    await again();
  });
});
