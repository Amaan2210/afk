import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeepAwakeController } from "../../src/daemon/keepawake.js";
import { createPowerRequest, type PowerRequest } from "../../src/daemon/power-request.js";

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

  it("dispose clears timers and releases", () => {
    c.update(["working"]);
    c.update(["idle"]);
    c.dispose();
    expect(req.held).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
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
