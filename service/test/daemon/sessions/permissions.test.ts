import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skipsPermissions } from "../../../src/daemon/sessions/permissions.js";
import { SessionRegistry } from "../../../src/daemon/sessions/registry.js";
import { createFakePty } from "../../helpers/fake-pty.js";

describe("skipsPermissions", () => {
  it("knows Claude's two ways to ask for nothing", () => {
    expect(skipsPermissions("claude", ["--dangerously-skip-permissions"])).toBe(true);
    expect(skipsPermissions("claude", ["--permission-mode", "bypassPermissions"])).toBe(true);
    expect(skipsPermissions("claude", ["--permission-mode=bypassPermissions"])).toBe(true);
    expect(skipsPermissions("claude", ["--permission-mode", "acceptEdits"])).toBe(false);
    expect(skipsPermissions("claude", ["--model", "opus"])).toBe(false);
  });

  it("knows Codex's flag and its short form", () => {
    expect(skipsPermissions("codex", ["--dangerously-bypass-approvals-and-sandbox"])).toBe(true);
    expect(skipsPermissions("codex", ["--yolo"])).toBe(true);
    expect(skipsPermissions("codex", ["--full-auto"])).toBe(false);
  });

  it("reads no flag after `--`, nor another agent's flag, nor any for a shell", () => {
    expect(skipsPermissions("claude", ["--", "--dangerously-skip-permissions"])).toBe(false);
    expect(skipsPermissions("claude", ["--yolo"])).toBe(false);
    expect(skipsPermissions("shell", ["--dangerously-skip-permissions"])).toBe(false);
  });
});

describe("a session's skipsPermissions", () => {
  let dir: string;
  let reg: SessionRegistry;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "afk-permissions-"));
    reg = new SessionRegistry({
      ptyFactory: createFakePty().factory,
      shell: { exe: "powershell.exe", kind: "powershell" },
      sessionsDir: join(dir, "sessions"),
      port: 2350,
      nodeExe: "node.exe",
      cliEntry: "cli.js",
      ringBufferBytes: 4096,
      snapshotScrollback: 100,
      retentionHours: 24,
      baseEnv: {},
    });
  });

  afterEach(async () => {
    reg.stopAll();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it("comes from the launch flags, and is left out when false", async () => {
    const skip = ["--dangerously-skip-permissions"];
    const bypass = await reg.create({ cwd: dir, kind: "claude", args: skip });
    const asks = await reg.create({ cwd: dir, kind: "claude", args: [] });
    expect(bypass.skipsPermissions).toBe(true);
    expect("skipsPermissions" in asks).toBe(false);
  });

  it("changes with setMeta, and false removes it", async () => {
    const { id } = await reg.create({ cwd: dir, kind: "claude", args: [] });
    reg.setMeta(id, { skipsPermissions: true });
    expect(reg.get(id)?.session.skipsPermissions).toBe(true);
    reg.setMeta(id, { skipsPermissions: false });
    expect("skipsPermissions" in (reg.get(id)?.session ?? {})).toBe(false);
  });
});
