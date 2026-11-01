import * as fsp from "node:fs/promises";
import { startHarness, type Harness } from "./harness.js";

// Only the stat calls a test arms fail; everything else uses the real file system.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  await h.stop();
});

function failStat(code: string): void {
  const err = Object.assign(new Error(`${code}: simulated`), { code });
  vi.mocked(fsp.stat).mockRejectedValueOnce(err);
}

describe("session.create when the folder cannot be read", () => {
  it.each(["ENOENT", "ENOTDIR"])("%s is the client's mistake: bad_request", async (code) => {
    const c = await h.client();
    failStat(code);
    expect(
      await c.request({ type: "session.create", cwd: h.dir, kind: "shell", args: [] }),
    ).toMatchObject({ type: "error", code: "bad_request", message: `${h.dir} is not a folder` });
  });

  it.each(["EACCES", "EPERM", "EIO"])(
    "%s is the daemon's: internal, with the code",
    async (code) => {
      const c = await h.client();
      failStat(code);
      expect(
        await c.request({ type: "session.create", cwd: h.dir, kind: "shell", args: [] }),
      ).toMatchObject({
        type: "error",
        code: "internal",
        message: `cannot read ${h.dir} (${code})`,
      });
      expect(h.registry.list()).toEqual([]);
    },
  );
});
