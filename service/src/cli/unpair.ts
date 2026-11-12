import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { CommandClient } from "./client.js";
import type { CommandIo } from "./run.js";

const STOP_WAIT_MS = 5000;

/** What stopping uses of a daemon client; tests hand it a fake. */
export type StopClient = CommandClient & { onClose(cb: () => void): () => void };

export interface UnpairOptions {
  /** Do not ask first. */
  yes?: boolean;
}

export interface UnpairIo extends CommandIo<StopClient> {
  /** Asks a yes/no question; undefined when input is not interactive. */
  confirm: (question: string) => Promise<boolean | undefined>;
  /** How long to wait for the daemon to go away once it has agreed to (default 5 s). */
  stopWaitMs?: number;
}

/** Asks on the terminal; anything but y or yes is a no. Undefined when stdin is not a TTY. */
export async function confirmOnTty(question: string): Promise<boolean | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

function plural(n: number, one: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${one}s`;
}

/** What stopping AFK ends, in plain words, for the question that follows it. */
export function stopWarning(phones: string[], running: number): string {
  const lines = ["This stops AFK on this laptop:"];
  lines.push(
    phones.length === 0
      ? "  - no phone is paired"
      : `  - the phone "${phones.join('", "')}" is unpaired`,
  );
  lines.push(
    running === 0
      ? "  - no session is running"
      : `  - ${plural(running, "running session")} will end, with whatever the agents are doing`,
  );
  return lines.join("\n");
}

/**
 * `afk unpair` and `afk service stop`: unpairs the phone, ends every session and stops the
 * daemon, after saying so and asking. Resolves with the exit code: 0 once stopped, 1 when the
 * answer was no or could not be asked for.
 */
export async function runUnpair(opts: UnpairOptions, io: UnpairIo): Promise<number> {
  const { stdout, client } = io;
  const [sessions, { devices }] = await Promise.all([
    client.sessions(),
    client.request<{ devices: { name: string }[] }>({ type: "device.list" }),
  ]);
  const running = sessions.filter((s) => s.state !== "ended").length;
  stdout.write(
    `${stopWarning(
      devices.map((d) => d.name),
      running,
    )}\n`,
  );
  if (opts.yes !== true) {
    const answer = await io.confirm("Stop AFK? [y/N] ");
    if (answer === undefined) {
      stdout.write(
        "Not stopped: there is no terminal to ask on. Add --yes to stop without asking.\n",
      );
      return 1;
    }
    if (!answer) {
      stdout.write("Nothing was changed.\n");
      return 1;
    }
  }
  const gone = new Promise<void>((resolve) => client.onClose(resolve));
  await client.request({ type: "daemon.stop" });
  await Promise.race([gone, sleep(io.stopWaitMs ?? STOP_WAIT_MS)]);
  stdout.write("AFK is stopped. `afk pair` pairs your phone again.\n");
  return 0;
}

/** What `afk unpair` and `afk service stop` print when no daemon is running. */
export function alreadyStopped(stdout: { write(text: string): unknown }): number {
  stdout.write("AFK is not running, so no phone is paired and no session is running.\n");
  return 0;
}
