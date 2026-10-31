import type { Session } from "../../protocol/index.js";
import type { SessionRegistry } from "../sessions/registry.js";

/**
 * The pending each session has had an answer typed for, or is having one typed for, so a repeated
 * answer (a double tap) never types its keys twice: a second "1" could approve the next prompt.
 * A session's entry goes as soon as its pending changes, so the next pending can be answered.
 */
export class AnsweredPendings {
  private readonly answered = new Map<string, string>();
  private readonly onUpdated = (session: Session): void => {
    if (this.answered.get(session.id) !== session.pending?.id) this.answered.delete(session.id);
  };
  private readonly onRemoved = (sessionId: string): void => {
    this.answered.delete(sessionId);
  };

  constructor(private readonly registry: SessionRegistry) {
    registry.on("updated", this.onUpdated);
    registry.on("removed", this.onRemoved);
  }

  /** Marks the session's pending `pendingId` answered; false when it already was. */
  claim(sessionId: string, pendingId: string): boolean {
    if (this.answered.get(sessionId) === pendingId) return false;
    this.answered.set(sessionId, pendingId);
    return true;
  }

  dispose(): void {
    this.registry.off("updated", this.onUpdated);
    this.registry.off("removed", this.onRemoved);
  }
}
