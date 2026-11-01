import { basename, join } from "node:path";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  await h.stop();
});

/** UNC, device and rooted paths: a stat of the first two would reach the network or a device. */
const REMOTE = [
  "\\\\server\\share\\app",
  "\\\\.\\pipe\\afk",
  "\\\\?\\C:\\app",
  "//server/share",
  "/\\server\\share",
  "\\app",
];

describe("session.create cwd", () => {
  it("must be absolute; a relative one is refused before it is looked at", async () => {
    const c = await h.client();
    const cwd = join("projects", "app");
    expect(await c.request({ type: "session.create", cwd, kind: "shell", args: [] })).toEqual({
      type: "error",
      id: expect.any(String),
      code: "bad_request",
      message: "cwd must be an absolute path",
    });
    expect(h.registry.list()).toEqual([]);
  });

  it.each(REMOTE)("refuses the network or device path %s", async (cwd) => {
    const c = await h.client();
    expect(await c.request({ type: "session.create", cwd, kind: "shell", args: [] })).toEqual({
      type: "error",
      id: expect.any(String),
      code: "bad_request",
      message: "network and device paths are not supported",
    });
    expect(h.registry.list()).toEqual([]);
  });
});

describe("fs.listDirs path", () => {
  it.each(REMOTE)("refuses the network or device path %s", async (path) => {
    const c = await h.client();
    expect(await c.request({ type: "fs.listDirs", path })).toMatchObject({
      type: "error",
      code: "bad_request",
      message: "network and device paths are not supported",
    });
  });
});

describe("session names", () => {
  async function created(name: string): Promise<string | undefined> {
    const c = await h.client();
    const reply = await c.request({
      type: "session.create",
      cwd: h.dir,
      kind: "shell",
      args: [],
      name,
    });
    if (reply.type !== "ack") return undefined;
    return h.registry.get(String(reply.sessionId))?.session.name;
  }

  it("are trimmed, and a blank one falls back to the folder's name", async () => {
    expect(await created("  api  ")).toBe("api");
    expect(await created(" \t ")).toBe(basename(h.dir));
  });

  it("are capped at 64 characters", async () => {
    const name = await created(`${"é".repeat(70)}`);
    expect(name).toBe("é".repeat(64));
    expect(await created(`${"a".repeat(63)} b`)).toBe("a".repeat(63));
  });

  it("refuse control characters on create and rename", async () => {
    const c = await h.client();
    for (const name of ["a\u0007b", "line\nbreak", "esc\u001b[31m", "del\u007f", "c1\u009b"]) {
      expect(
        await c.request({ type: "session.create", cwd: h.dir, kind: "shell", args: [], name }),
      ).toMatchObject({
        type: "error",
        code: "bad_request",
        message: "name must not contain control characters",
      });
    }
    expect(h.registry.list()).toEqual([]);

    const { session } = await h.session();
    const rename = (name: string) =>
      c.request({ type: "session.rename", sessionId: session.id, name });
    expect(await rename("bad\u0000name")).toMatchObject({ type: "error", code: "bad_request" });
    expect(await rename("   ")).toMatchObject({
      type: "error",
      code: "bad_request",
      message: "name must not be empty",
    });
    expect(h.registry.get(session.id)?.session.name).toBe(session.name);

    expect(await rename(`  ${"n".repeat(80)}  `)).toMatchObject({ type: "ack" });
    expect(h.registry.get(session.id)?.session.name).toBe("n".repeat(64));
  });
});

describe("session.create stat", () => {
  it("still reports a missing folder as bad_request", async () => {
    const c = await h.client();
    const cwd = join(h.dir, "missing");
    expect(await c.request({ type: "session.create", cwd, kind: "shell", args: [] })).toMatchObject(
      { type: "error", code: "bad_request", message: `${cwd} is not a folder` },
    );
  });
});
