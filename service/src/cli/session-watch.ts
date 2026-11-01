import type { Session } from "../protocol/index.js";
import type { Frame } from "./client.js";

/** The part of a daemon client a watch listens on. */
export interface WatchClient {
  on(type: string, cb: (m: Frame) => void): () => void;
}

/**
 * The latest state the daemon announced for each session, kept from the moment the watch is
 * made. The daemon can announce a new session before it acks `session.create`, so a launcher
 * starts the watch before sending the request. `seed` adds the older list from the greeting.
 */
export class SessionWatch {
  private readonly latest = new Map<string, Session>();
  private readonly removed = new Set<string>();
  private readonly changeListeners = new Set<(sessionId: string) => void>();
  private readonly stops: (() => void)[];

  constructor(client: WatchClient) {
    this.stops = [
      client.on("session.updated", (m) => this.update(m.session as Session)),
      client.on("session.removed", (m) => this.remove(String(m.sessionId))),
    ];
  }

  /** Adds sessions from a list older than every update seen so far; never overrides one. */
  seed(sessions: Session[]): void {
    for (const s of sessions) {
      if (!this.latest.has(s.id) && !this.removed.has(s.id)) this.latest.set(s.id, s);
    }
  }

  /** The latest announced state; a removed session keeps its last one. */
  get(sessionId: string): Session | undefined {
    return this.latest.get(sessionId);
  }

  isRemoved(sessionId: string): boolean {
    return this.removed.has(sessionId);
  }

  /** The sessions the daemon still has. */
  list(): Session[] {
    return [...this.latest.values()].filter((s) => !this.removed.has(s.id));
  }

  /** Calls `cb` with the id of every session updated or removed; the returned function stops it. */
  onChange(cb: (sessionId: string) => void): () => void {
    this.changeListeners.add(cb);
    return () => void this.changeListeners.delete(cb);
  }

  stop(): void {
    for (const stop of this.stops) stop();
    this.changeListeners.clear();
  }

  private update(session: Session): void {
    this.latest.set(session.id, session);
    this.changed(session.id);
  }

  private remove(sessionId: string): void {
    this.removed.add(sessionId);
    this.changed(sessionId);
  }

  private changed(sessionId: string): void {
    for (const cb of [...this.changeListeners]) cb(sessionId);
  }
}
