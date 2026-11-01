import type { Server } from "node:http";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type pino from "pino";
import type { DaemonConfig } from "./config.js";
import {
  closeServer,
  listenAll,
  pickBindAddresses,
  tailscaleAdapterIp,
  type BindPlan,
  type InterfaceAddress,
} from "./net.js";

const DEFAULT_START_WAIT_MS = 30_000;
const DEFAULT_START_POLL_MS = 2_000;
const DEFAULT_REPROBE_MS = 30_000;

/** How the daemon looks for this machine's Tailscale address, and for how long. */
export interface TailscaleOptions {
  /** The network interfaces, read at each look (default `os.networkInterfaces()`). */
  interfaces?: () => NodeJS.Dict<InterfaceAddress[]>;
  /** Whether an address is Tailscale's (default: inside 100.64.0.0/10). Tests use 127.0.0.2. */
  isTailscale?: (address: string) => boolean;
  /** How long a start waits for an address before listening on 127.0.0.1 alone (default 30 s). */
  startWaitMs?: number;
  /** How often a start looks while it waits (default 2 s). */
  startPollMs?: number;
  /** How often a daemon running without an address looks again (default 30 s). */
  reprobeMs?: number;
}

function interfacesOf(o: TailscaleOptions): () => NodeJS.Dict<InterfaceAddress[]> {
  return o.interfaces ?? (() => os.networkInterfaces());
}

/**
 * Where to listen for `bind`. With "tailscale" and no Tailscale address yet (at logon Tailscale
 * can come up after the daemon), it first waits up to `startWaitMs` for one, looking every
 * `startPollMs`; `onWait` runs once, when the wait begins. Then the plan as it stands. `signal`
 * ends the wait at once: it rejects with an AbortError.
 */
export async function planBind(
  bind: DaemonConfig["bind"],
  o: TailscaleOptions,
  onWait: () => void,
  signal?: AbortSignal,
): Promise<BindPlan> {
  const interfaces = interfacesOf(o);
  const plan = (): BindPlan => pickBindAddresses(bind, interfaces(), o.isTailscale);
  let current = plan();
  if (bind !== "tailscale" || current.tailscaleIp !== undefined) return current;
  const waitMs = o.startWaitMs ?? DEFAULT_START_WAIT_MS;
  if (waitMs <= 0) return current;
  onWait();
  const deadline = Date.now() + waitMs;
  while (current.tailscaleIp === undefined && Date.now() < deadline) {
    const ms = Math.min(o.startPollMs ?? DEFAULT_START_POLL_MS, deadline - Date.now());
    await sleep(ms, undefined, { signal });
    current = plan();
  }
  return current;
}

export interface RebindOptions {
  tailscale: TailscaleOptions;
  /** The daemon's port, which the new address listens on too. */
  port: number;
  /** A new http server with the daemon's request handler and timeouts. */
  create: () => Server;
  /** Takes the server once it listens on the Tailscale address `address`. */
  onListening: (server: Server, address: string) => void;
  log: pino.Logger;
}

export interface Rebinder {
  /** Stops looking; a server that was still starting is closed. Resolves once nothing is left. */
  stop(): Promise<void>;
}

/**
 * For a daemon that started without a Tailscale address: looks for one every `reprobeMs` and,
 * when one appears on Tailscale's own adapter (only there: the daemon keeps it for its lifetime
 * and pairs phones to it), listens on it with a server from `create`, hands that to
 * `onListening` and stops looking. A failed listen is logged and tried again at the next look.
 */
export function listenWhenTailscaleAppears(o: RebindOptions): Rebinder {
  const interfaces = interfacesOf(o.tailscale);
  let stopped = false;
  let attempt: Promise<void> | undefined;

  const tryListen = async (): Promise<void> => {
    const address = tailscaleAdapterIp(interfaces(), o.tailscale.isTailscale);
    if (address === undefined || stopped) return;
    const servers: Server[] = [];
    try {
      await listenAll([address], o.port, o.create, servers);
    } catch (err) {
      await Promise.all(servers.map(closeServer));
      o.log.warn({ err, address }, "could not listen on the Tailscale address; will try again");
      return;
    }
    const [server] = servers;
    if (server === undefined) return;
    // stop() came while this server started: it waits for this attempt, so close it here.
    if (stopped) return closeServer(server);
    clearInterval(timer);
    o.log.info({ address, port: o.port }, "listening on the Tailscale address that appeared");
    o.onListening(server, address);
  };

  const timer = setInterval(() => {
    attempt ??= tryListen()
      .catch((err: unknown) => o.log.warn({ err }, "looking for a Tailscale address failed"))
      .finally(() => (attempt = undefined));
  }, o.tailscale.reprobeMs ?? DEFAULT_REPROBE_MS);
  timer.unref();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await attempt;
    },
  };
}
