import type { RequestListener, Server } from "node:http";
import { isIP, type AddressInfo } from "node:net";
import os from "node:os";
import type { DaemonConfig } from "./config.js";

const LOOPBACK = "127.0.0.1";

/** The fields of an `os.networkInterfaces()` entry read here. */
export interface InterfaceAddress {
  address: string;
  /** Node 18.0–18.3 reported 4 or 6 instead of "IPv4" or "IPv6". */
  family: string | number;
  internal: boolean;
}

export interface BindPlan {
  /** Where to listen, the first one first; 127.0.0.1 is always among them. */
  addresses: string[];
  /** The Tailscale address among `addresses`, if any. */
  tailscaleIp?: string;
  /** Why the daemon listens on fewer addresses than configured. */
  warning?: string;
}

/** Tailscale gives each device an address in the CGNAT range 100.64.0.0/10. */
function isTailscaleIpv4(address: string): boolean {
  const [first = 0, second = 0] = address.split(".").map(Number);
  return isIP(address) === 4 && first === 100 && second >= 64 && second <= 127;
}

/**
 * Tailscale's own adapter ("Tailscale" on Windows, "tailscale0" on Linux) first: another link,
 * such as a phone tethered over USB on a carrier's CGNAT, can have an address in the same range.
 */
function findTailscaleIp(interfaces: NodeJS.Dict<InterfaceAddress[]>): string | undefined {
  const candidates: { name: string; address: string }[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const { address, family, internal } of entries ?? []) {
      const ipv4 = family === "IPv4" || family === 4;
      if (ipv4 && !internal && isTailscaleIpv4(address)) candidates.push({ name, address });
    }
  }
  return (candidates.find((c) => /tailscale/i.test(c.name)) ?? candidates[0])?.address;
}

/** 0.0.0.0 or ::, which take every interface, 127.0.0.1 included. */
function isWildcard(address: string): boolean {
  return isIP(address) !== 0 && /^[0:.]+$/.test(address);
}

/**
 * The addresses the daemon listens on for the configured `bind`:
 * - `"tailscale"`: this machine's Tailscale IPv4 address and 127.0.0.1, or 127.0.0.1 alone with a
 *   warning when Tailscale has no address;
 * - `"loopback"`: 127.0.0.1;
 * - an IP address: that address and 127.0.0.1, or a wildcard (`0.0.0.0`, `::`) alone.
 * The daemon never listens on every interface unless the config names a wildcard itself.
 */
export function pickBindAddresses(
  bind: DaemonConfig["bind"],
  interfaces: NodeJS.Dict<InterfaceAddress[]> = os.networkInterfaces(),
): BindPlan {
  if (bind === "loopback") return { addresses: [LOOPBACK] };
  if (bind === "tailscale") {
    const ip = findTailscaleIp(interfaces);
    if (ip !== undefined) return { addresses: [ip, LOOPBACK], tailscaleIp: ip };
    return {
      addresses: [LOOPBACK],
      warning:
        "No Tailscale address found (100.64.0.0/10), so the daemon listens on 127.0.0.1 only and " +
        "the phone cannot reach it. Start Tailscale, then restart the daemon.",
    };
  }
  // An empty host would make listen() take every interface.
  if (bind.trim() === "") {
    return {
      addresses: [LOOPBACK],
      warning: 'The configured "bind" is empty, so the daemon listens on 127.0.0.1 only.',
    };
  }
  if (isWildcard(bind)) return { addresses: [bind] };
  const addresses = [...new Set([bind, LOOPBACK])];
  return isTailscaleIpv4(bind) ? { addresses, tailscaleIp: bind } : { addresses };
}

export interface DeferredListener {
  /** The listener to give the http servers now. */
  listener: RequestListener;
  /** Routes every later request to `handler`. */
  use(handler: RequestListener): void;
}

/**
 * A request listener that answers 503 until the real one is ready. The daemon must listen before
 * it can build the parts that need the port, so its servers start with this.
 */
export function deferredListener(): DeferredListener {
  let handler: RequestListener | undefined;
  return {
    listener: (req, res) => {
      if (handler !== undefined) return handler(req, res);
      const body = JSON.stringify({ error: "starting" });
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
    },
    use(next) {
      handler = next;
    },
  };
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Resolves once the server has stopped listening (or never was) and every connection is gone. */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function listenEach(
  addresses: string[],
  port: number,
  create: () => Server,
  servers: Server[],
): Promise<number> {
  let bound = port;
  for (const address of addresses) {
    const server = create();
    servers.push(server);
    bound = await listen(server, bound, address);
  }
  return bound;
}

/**
 * Listens a server from `create` on each address, all on one port, and resolves to that port.
 * Given port 0, the first address picks it; a later address may find it taken, and then every
 * address is tried once more on a fresh port. Each server goes into `servers` as it is created, so
 * that after a failure the caller can close them all.
 */
export async function listenAll(
  addresses: string[],
  port: number,
  create: () => Server,
  servers: Server[],
): Promise<number> {
  const first = servers.length;
  try {
    return await listenEach(addresses, port, create, servers);
  } catch (err) {
    if (port !== 0 || (err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    await Promise.all(servers.splice(first).map(closeServer));
    return listenEach(addresses, 0, create, servers);
  }
}
