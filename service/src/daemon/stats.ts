import { EventEmitter } from "node:events";
import os from "node:os";
import type { Stats } from "../protocol/index.js";

interface StatsSamplerOpts {
  intervalMs?: number;
  os?: Pick<typeof os, "freemem" | "totalmem" | "cpus">;
  now?: () => Date;
}

interface CpuTotals {
  idle: number;
  total: number;
}

function totals(cpus: os.CpuInfo[]): CpuTotals {
  let idle = 0;
  let total = 0;
  for (const { times } of cpus) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/** Samples laptop RAM/CPU; emits "sample" (Stats) every interval while started. */
export class StatsSampler extends EventEmitter {
  private readonly intervalMs: number;
  private readonly os: Pick<typeof os, "freemem" | "totalmem" | "cpus">;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | undefined;
  private prev: CpuTotals | undefined;

  constructor(opts: StatsSamplerOpts = {}) {
    super();
    this.intervalMs = opts.intervalMs ?? 5000;
    this.os = opts.os ?? os;
    this.now = opts.now ?? (() => new Date());
  }

  start(getKeepAwake: () => boolean = () => false): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.emit("sample", this.current(getKeepAwake())),
      this.intervalMs,
    );
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  current(keepAwakeActive: boolean): Stats {
    const totalmem = this.os.totalmem();
    return {
      at: this.now().toISOString(),
      ramUsedBytes: totalmem - this.os.freemem(),
      ramTotalBytes: totalmem,
      cpuPercent: this.cpuPercent(),
      keepAwakeActive,
    };
  }

  private cpuPercent(): number {
    const cur = totals(this.os.cpus());
    const prev = this.prev ?? { idle: 0, total: 0 };
    this.prev = cur;
    const total = cur.total - prev.total;
    if (total <= 0) return 0;
    const busy = (1 - (cur.idle - prev.idle) / total) * 100;
    return Math.round(Math.min(100, Math.max(0, busy)) * 10) / 10;
  }
}
