import { connect } from "node:net";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { tailscaleAdapterIp } from "../daemon/net.js";
import { pairPayload, renderQr } from "./format.js";
import { CliError, type ClientOptions, type CommandIo, type Output } from "./run.js";

const DEFAULT_NAME = "phone";
const TAILSCALE_WAIT_MS = 5 * 60_000;
const LISTEN_WAIT_MS = 20_000;
const POLL_MS = 1000;
const PROBE_TIMEOUT_MS = 1000;

export interface PairOptions extends ClientOptions {
  name?: string;
}

export interface PairIo extends CommandIo {
  /** Asks what to call the phone; undefined when input is not interactive. */
  promptName: () => Promise<string | undefined>;
  /** Progress, kept apart from what the phone scans (default: process.stderr). */
  stderr?: Output;
  /** This machine's Tailscale address as it is now (default: read from the network adapters). */
  tailscaleIp?: () => string | undefined;
  /** Whether something accepts connections on `host`:`port` (default: a 1 s TCP connect). */
  reachable?: (host: string, port: number) => Promise<boolean>;
  /** How long to wait for Tailscale to come up (default 5 min). */
  tailscaleWaitMs?: number;
  /** How long to wait for the daemon to listen on the address once it is there (default 20 s). */
  listenWaitMs?: number;
  /** How often to look meanwhile (default 1 s). */
  pollMs?: number;
}

/** Asks on the terminal what to call the phone; undefined when stdin is not a TTY. */
export async function promptNameOnTty(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(`Name for this phone [${DEFAULT_NAME}]: `);
  } finally {
    rl.close();
  }
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: PROBE_TIMEOUT_MS });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Looks every `pollMs` until `look` finds something or `waitMs` has passed. */
async function waitFor<T>(
  look: () => T | undefined | Promise<T | undefined>,
  waitMs: number,
  pollMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const found = await look();
    if (found !== undefined || Date.now() >= deadline) return found;
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

/**
 * The address the phone reaches the daemon at. The daemon's own, when it already listens on one.
 * Otherwise Tailscale is not up: this says so, waits for it to come up, then for the daemon
 * (which looks for it every few seconds) to listen there.
 */
async function phoneAddress(io: PairIo): Promise<string> {
  const known = io.client.hello.daemon.tailscaleIp;
  if (known !== undefined) return known;
  const err = io.stderr ?? process.stderr;
  const lookUp = io.tailscaleIp ?? (() => tailscaleAdapterIp(os.networkInterfaces()));
  const pollMs = io.pollMs ?? POLL_MS;
  let host = lookUp();
  if (host === undefined) {
    err.write(
      "Tailscale is not running on this laptop, and the phone reaches it over Tailscale.\n" +
        "Start Tailscale here and on your phone, signed in to the same account.\n" +
        "Waiting for Tailscale… (Ctrl+C cancels)\n",
    );
    host = await waitFor(lookUp, io.tailscaleWaitMs ?? TAILSCALE_WAIT_MS, pollMs);
    if (host === undefined) {
      throw new CliError("Tailscale did not come up. Start it, then run `afk pair` again.");
    }
    err.write(`Tailscale is up (${host}).\n`);
  }
  const address = host;
  const reachable = io.reachable ?? canConnect;
  const listening = await waitFor(
    async () => ((await reachable(address, io.port)) ? true : undefined),
    io.listenWaitMs ?? LISTEN_WAIT_MS,
    pollMs,
  );
  if (listening !== true) {
    throw new CliError(
      `AFK is not listening on the Tailscale address ${address}:${io.port}. It does when \`bind\` ` +
        "in its config is `tailscale` (the default). Check that, then run `afk pair` again.",
    );
  }
  return address;
}

/**
 * Pairs a phone, in place of any paired before, and prints what it scans: a QR code, and the same
 * three values to type instead. The token is a secret shown once, on purpose; it goes to stdout
 * and nowhere else.
 */
export async function runPair(opts: PairOptions, io: PairIo): Promise<void> {
  const { stdout, client } = io;
  // Before adding, so a daemon the phone cannot reach does not replace a working pairing.
  const host = await phoneAddress(io);
  const asked = opts.name ?? (await io.promptName());
  const name = asked?.trim() || DEFAULT_NAME;
  const { token } = await client.request<{ deviceId: string; token: string }>({
    type: "device.add",
    name,
  });
  const payload = pairPayload(host, token, io.port);
  stdout.write(
    [
      "",
      `Pair "${name}" with this laptop (${client.hello.daemon.hostname}):`,
      "",
      "  1. Open the AFK app on the phone.",
      "  2. Scan this code, or type the three values under it.",
      "",
      renderQr(payload),
      "",
      `  Host   ${payload.host}`,
      `  Port   ${payload.port}`,
      `  Token  ${payload.token}`,
      "",
      "The token is shown only this once. Keep this window private until the phone is paired.",
      "AFK keeps running in the background until you run `afk unpair`.",
      "",
    ].join("\n"),
  );
}
