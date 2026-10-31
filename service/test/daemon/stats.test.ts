import type os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsSampler } from "../../src/daemon/stats.js";
import type { Stats } from "../../src/protocol/index.js";

type FakeOs = Pick<typeof os, "freemem" | "totalmem" | "cpus">;

function cpu(idle: number, busy: number): os.CpuInfo {
  return {
    model: "fake",
    speed: 1000,
    times: { user: busy, nice: 0, sys: 0, idle, irq: 0 },
  };
}

function fakeOs(cpuSnapshots: os.CpuInfo[][]): FakeOs {
  let i = 0;
  return {
    totalmem: () => 16e9,
    freemem: () => 4e9,
    cpus: () => cpuSnapshots[Math.min(i++, cpuSnapshots.length - 1)] ?? [],
  };
}

describe("StatsSampler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("current reports ram and cpu from os", () => {
    const s = new StatsSampler({ os: fakeOs([[cpu(300, 100), cpu(300, 100)]]) });
    const stats = s.current(true);
    expect(stats.ramUsedBytes).toBe(12e9);
    expect(stats.ramTotalBytes).toBe(16e9);
    expect(stats.keepAwakeActive).toBe(true);
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(stats.cpuPercent).toBeLessThanOrEqual(100);
    expect(Number.isNaN(Date.parse(stats.at))).toBe(false);
  });

  it("uses cumulative times for the first call (25% busy)", () => {
    const s = new StatsSampler({ os: fakeOs([[cpu(300, 100)]]) });
    expect(s.current(false).cpuPercent).toBe(25);
  });

  it("computes cpuPercent from the delta between two snapshots", () => {
    const s = new StatsSampler({
      os: fakeOs([
        [cpu(100, 100)],
        [cpu(160, 140)], // +60 idle, +40 busy -> 40%
        [cpu(160, 140)], // no change -> 0%
      ]),
    });
    s.current(false);
    expect(s.current(false).cpuPercent).toBe(40);
    expect(s.current(false).cpuPercent).toBe(0);
  });

  it("rounds to one decimal and clamps to 0-100", () => {
    const s = new StatsSampler({ os: fakeOs([[cpu(0, 0)], [cpu(2, 1)], [cpu(1, 100)]]) });
    s.current(false);
    expect(s.current(false).cpuPercent).toBe(33.3);
    // idle went backwards (counter glitch) -> clamped
    expect(s.current(false).cpuPercent).toBe(100);
  });

  it("uses the injected clock for at", () => {
    const s = new StatsSampler({
      os: fakeOs([[cpu(1, 1)]]),
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });
    expect(s.current(false).at).toBe("2026-01-02T03:04:05.000Z");
  });

  it("start emits samples on each tick and stop halts them", () => {
    vi.useFakeTimers();
    const s = new StatsSampler({ intervalMs: 1000, os: fakeOs([[cpu(1, 1)]]) });
    const seen: Stats[] = [];
    s.on("sample", (st: Stats) => seen.push(st));
    let awake = false;
    s.start(() => awake);
    s.start(); // idempotent
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.keepAwakeActive).toBe(false);
    awake = true;
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.keepAwakeActive).toBe(true);
    s.stop();
    vi.advanceTimersByTime(5000);
    expect(seen).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to a 5 s interval", () => {
    vi.useFakeTimers();
    const s = new StatsSampler({ os: fakeOs([[cpu(1, 1)]]) });
    const spy = vi.fn();
    s.on("sample", spy);
    s.start();
    vi.advanceTimersByTime(4999);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    s.stop();
  });
});
