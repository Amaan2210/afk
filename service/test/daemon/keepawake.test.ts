import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followSessions, KeepAwakeController } from "../../src/daemon/keepawake.js";
import { createPowerRequest, type PowerRequest } from "../../src/daemon/power-request.js";
import { SessionRegistry } from "../../src/daemon/sessions/registry.js";
import { createFakePty } from "../helpers/fake-pty.js";

class FakeRequest implements PowerRequest {
  held = false;
  holds = 0;
  releases = 0;
  hold(): void {
    this.held = true;
    this.holds++;
  }
  release(): void {
    this.held = false;
    this.releases++;
  }
}

describe("KeepAwakeController", () => {
  let req: FakeRequest;
  let c: KeepAwakeController;

  beforeEach(() => {
    vi.useFakeTimers();
    req = new FakeRequest();
    c = new KeepAwakeController(req, { graceMs: 1000 });
  });
  afterEach(() => {
    c.dispose();
    vi.useRealTimers();
  });

  it("holds while any session is working or needs_input", () => {
    c.update(["idle", "working"]);
    expect(req.held).toBe(true);
    expect(c.active).toBe(true);
    c.update(["needs_input"]);
    expect(req.held).toBe(true);
    expect(req.holds).toBe(1);
  });

  it("does nothing when nothing is working", () => {
    c.update(["idle", "finished", "ended"]);
    expect(req.held).toBe(false);
    expect(c.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases only after the grace period once all are idle/finished/ended", () => {
    c.update(["working"]);
    c.update(["finished"]);
    expect(req.held).toBe(true);
    vi.advanceTimersByTime(999);
    expect(req.held).toBe(true);
    vi.advanceTimersByTime(1);
    expect(req.held).toBe(false);
    expect(c.active).toBe(false);
  });

  it("re-holding during grace cancels the release", () => {
    c.update(["working"]);
    c.update(["idle"]);
    vi.advanceTimersByTime(500);
    c.update(["working"]);
    vi.advanceTimersByTime(5000);
    expect(req.held).toBe(true);
    expect(req.releases).toBe(0);
  });

  it("repeated idle updates do not extend the grace", () => {
    c.update(["working"]);
    c.update(["idle"]);
    vi.advanceTimersByTime(600);
    c.update(["idle"]);
    vi.advanceTimersByTime(400);
    expect(req.held).toBe(false);
  });

  it("setEnabled(false) releases immediately and ignores updates", () => {
    c.update(["working"]);
    c.update(["idle"]);
    c.setEnabled(false);
    expect(req.held).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    c.update(["working"]);
    expect(req.held).toBe(false);
    expect(c.active).toBe(false);
  });

  it("setEnabled(true) re-evaluates with the last known states", () => {
    c.setEnabled(false);
    c.update(["working"]);
    expect(req.held).toBe(false);
    c.setEnabled(true);
    expect(req.held).toBe(true);
    expect(c.active).toBe(true);
  });

  it("setGraceMs re-arms a pending release with the new grace, counted from now", () => {
    c.update(["working"]);
    c.update(["idle"]);
    vi.advanceTimersByTime(600);
    c.setGraceMs(3000);
    vi.advanceTimersByTime(2999);
    expect(req.held).toBe(true);
    vi.advanceTimersByTime(1);
    expect(req.held).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("setGraceMs shortening the grace releases sooner", () => {
    c.update(["working"]);
    c.update(["idle"]);
    c.setGraceMs(100);
    vi.advanceTimersByTime(100);
    expect(req.held).toBe(false);
    expect(req.releases).toBe(1);
  });

  it("setGraceMs with the current grace leaves a pending release alone", () => {
    c.update(["working"]);
    c.update(["idle"]);
    vi.advanceTimersByTime(600);
    c.setGraceMs(1000); // unchanged, e.g. a settings change that touched only retentionHours
    vi.advanceTimersByTime(400);
    expect(req.held).toBe(false);
  });

  it("setGraceMs with no release pending arms nothing and applies to the next release", () => {
    c.setGraceMs(200);
    expect(vi.getTimerCount()).toBe(0);
    c.update(["working"]);
    c.setGraceMs(300);
    expect(vi.getTimerCount()).toBe(0); // still busy: nothing to re-arm
    c.update(["idle"]);
    vi.advanceTimersByTime(299);
    expect(req.held).toBe(true);
    vi.advanceTimersByTime(1);
    expect(req.held).toBe(false);
  });

  it("dispose clears timers and releases", () => {
    c.update(["working"]);
    c.update(["idle"]);
    c.dispose();
    expect(req.held).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("followSessions", () => {
  it("holds while a registry session works, until it stops following", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afk-follow-"));
    const registry = new SessionRegistry({
      ptyFactory: createFakePty().factory,
      shell: { exe: "powershell.exe", kind: "powershell" },
      sessionsDir: dir,
      port: 2350,
      nodeExe: "node.exe",
      cliEntry: "cli.js",
      ringBufferBytes: 4096,
      snapshotScrollback: 100,
      retentionHours: 24,
      baseEnv: {},
    });
    const req = new FakeRequest();
    const keepAwake = new KeepAwakeController(req, { graceMs: 0 });
    const unfollow = followSessions(keepAwake, registry);
    try {
      const { id } = await registry.create({ cwd: dir, kind: "shell", args: [] });
      expect(req.held).toBe(false);
      registry.signal(id, { kind: "turn_start" });
      expect(req.held).toBe(true);
      registry.signal(id, { kind: "turn_end" });
      await vi.waitFor(() => expect(req.held).toBe(false));

      unfollow();
      registry.signal(id, { kind: "turn_start" });
      expect(req.held).toBe(false);
    } finally {
      unfollow();
      keepAwake.dispose();
      registry.stopAll();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createPowerRequest", () => {
  it("is a no-op off Windows", () => {
    const r = createPowerRequest("linux");
    expect(() => {
      r.hold();
      r.release();
    }).not.toThrow();
    expect(r.lastError).toBeUndefined();
  });

  describe.runIf(process.platform === "win32")("on win32", () => {
    it("holds and releases through SetThreadExecutionState without error", () => {
      const r = createPowerRequest("win32");
      r.hold();
      r.release();
      expect(r.lastError).toBeUndefined();
    });
  });
});
