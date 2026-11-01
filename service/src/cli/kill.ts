import type { CommandIo } from "./run.js";

/** Ends a session; the daemon answers an unknown id with a `not_found` error. */
export async function runKill(sessionId: string, { stdout, client }: CommandIo): Promise<void> {
  await client.request({ type: "session.kill", sessionId });
  stdout.write(`Killed ${sessionId}.\n`);
}
