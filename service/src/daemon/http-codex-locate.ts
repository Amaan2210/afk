import type pino from "pino";
import { findRolloutFile } from "./agents/codex/locate.js";
import type { ChatHub } from "./agents/hub.js";
import type { SessionRegistry } from "./sessions/registry.js";

export interface CodexLocatorDeps {
  registry: SessionRegistry;
  hub: ChatHub;
  log: pino.Logger;
  sessionsDir: string;
  intervalMs: number;
  timeoutMs: number;
}

interface Loop {
  cancelled: boolean;
  timer?: NodeJS.Timeout;
}

/**
 * After `afk exec` starts Codex, looks for its rollout file (by working directory and start time)
 * so the chat attaches before the first notify names the thread. One loop per session.
 */
export class CodexLocator {
  private readonly loops = new Map<string, Loop>();

  constructor(private readonly deps: CodexLocatorDeps) {}

  /** Starts (or restarts) the loop for a session; the first attempt runs immediately. */
  start(sessionId: string): void {
    this.stop(sessionId);
    const loop: Loop = { cancelled: false };
    this.loops.set(sessionId, loop);
    void this.attempt(sessionId, loop, Date.now() + this.deps.timeoutMs);
  }

  stop(sessionId: string): void {
    const loop = this.loops.get(sessionId);
    if (!loop) return;
    loop.cancelled = true;
    clearTimeout(loop.timer);
    this.loops.delete(sessionId);
  }

  dispose(): void {
    for (const id of [...this.loops.keys()]) this.stop(id);
  }

  private async attempt(sessionId: string, loop: Loop, deadline: number): Promise<void> {
    const { registry, hub, log, sessionsDir } = this.deps;
    const record = registry.get(sessionId);
    if (!record || record.session.state === "ended" || record.meta.rolloutPath !== undefined) {
      this.stop(sessionId);
      return;
    }
    let found: string | undefined;
    try {
      found = await findRolloutFile(sessionsDir, {
        cwd: record.session.cwd,
        since: new Date(record.session.createdAt),
      });
    } catch (err) {
      log.warn({ err, sessionId }, "codex rollout lookup failed");
    }
    if (loop.cancelled) return;
    if (found !== undefined && registry.get(sessionId)) {
      registry.setMeta(sessionId, { rolloutPath: found });
      hub.attachCodex(sessionId, found);
      log.debug({ sessionId, rolloutPath: found }, "codex rollout located");
      this.stop(sessionId);
      return;
    }
    if (Date.now() >= deadline) {
      log.debug({ sessionId }, "codex rollout not found before timeout");
      this.stop(sessionId);
      return;
    }
    loop.timer = setTimeout(
      () => void this.attempt(sessionId, loop, deadline),
      this.deps.intervalMs,
    );
    loop.timer.unref();
  }
}
