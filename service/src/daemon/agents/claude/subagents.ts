import { EventEmitter } from "node:events";
import { readdirSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../../../util/is-record.js";

const DEFAULT_POLL_MS = 1000;
const AGENT_FILE = /^agent-.+\.jsonl$/;

/** Where Claude Code writes a session's sub-agent transcripts: `<dir>/<sessionId>/subagents`. */
export function subagentDirFor(transcriptPath: string): string {
  const { dir, name } = path.win32.parse(transcriptPath);
  return path.win32.join(dir, name, "subagents");
}

/** A sub-agent's chat thread id from its transcript file: `agent-abc123.jsonl` → `agent-abc123`. */
export function threadIdForAgentFile(file: string): string {
  return path.win32.basename(file, ".jsonl");
}

/**
 * The uuid of the main-transcript assistant line that started a sub-agent, read from the
 * `fork-context-ref` line its file begins with; undefined for any other line.
 */
export function parentUuidOf(line: unknown): string | undefined {
  if (!isRecord(line) || line.type !== "fork-context-ref") return undefined;
  return typeof line.parentLastUuid === "string" ? line.parentLastUuid : undefined;
}

export interface SubagentWatcherEvents {
  /** A sub-agent transcript seen for the first time, files present at `start()` included. */
  file: [path: string, threadId: string];
}

/** Polls a session's sub-agent directory, which may not exist yet, for `agent-*.jsonl` files. */
export class SubagentWatcher extends EventEmitter<SubagentWatcherEvents> {
  private readonly seen = new Set<string>();
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    readonly dir: string,
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {
    super();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.poll();
      if (this.running) this.schedule(this.pollMs);
    }, delayMs);
  }

  private poll(): void {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return; // not created yet: Claude makes it when the first sub-agent starts
    }
    for (const name of names) {
      if (!this.running) return;
      if (!AGENT_FILE.test(name) || this.seen.has(name)) continue;
      this.seen.add(name);
      this.emit("file", path.join(this.dir, name), threadIdForAgentFile(name));
    }
  }
}
