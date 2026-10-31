import type { SessionState } from "../protocol/index.js";
import type { PowerRequest } from "./power-request.js";

interface KeepAwakeOpts {
  graceMs: number;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/** Holds a power request while any session is busy; releases after a grace period. */
export class KeepAwakeController {
  private graceMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private enabled = true;
  private held = false;
  private states: SessionState[] = [];
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly req: PowerRequest,
    opts: KeepAwakeOpts,
  ) {
    this.graceMs = opts.graceMs;
    this.setTimer = opts.setTimeout ?? setTimeout;
    this.clearTimer = opts.clearTimeout ?? clearTimeout;
  }

  get active(): boolean {
    return this.held;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.evaluate();
    } else {
      this.cancelRelease();
      this.releaseNow();
    }
  }

  /** A release already pending is re-armed with the new grace, counted from now. */
  setGraceMs(ms: number): void {
    this.graceMs = ms;
    if (!this.releaseTimer) return;
    this.cancelRelease();
    this.armRelease();
  }

  update(states: SessionState[]): void {
    this.states = states;
    if (this.enabled) this.evaluate();
  }

  dispose(): void {
    this.cancelRelease();
    this.releaseNow();
  }

  private evaluate(): void {
    if (this.states.some((s) => s === "working" || s === "needs_input")) {
      this.cancelRelease();
      if (!this.held) {
        this.held = true;
        this.req.hold();
      }
    } else if (this.held && !this.releaseTimer) {
      this.armRelease();
    }
  }

  private armRelease(): void {
    this.releaseTimer = this.setTimer(() => {
      this.releaseTimer = undefined;
      this.releaseNow();
    }, this.graceMs);
    (this.releaseTimer as { unref?: () => void }).unref?.();
  }

  private cancelRelease(): void {
    if (!this.releaseTimer) return;
    this.clearTimer(this.releaseTimer);
    this.releaseTimer = undefined;
  }

  private releaseNow(): void {
    if (!this.held) return;
    this.held = false;
    this.req.release();
  }
}
