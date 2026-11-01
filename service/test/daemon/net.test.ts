import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  closeServer,
  deferredListener,
  listenAll,
  pickBindAddresses,
} from "../../src/daemon/net.js";

describe("pickBindAddresses", () => {
  it("pickBindAddresses finds the tailscale address", () =>
    expect(
      pickBindAddresses("tailscale", {
        eth: [{ address: "192.168.1.2", family: "IPv4", internal: false }],
        ts: [{ address: "100.84.12.9", family: "IPv4", internal: false }],
      }),
    ).toEqual({ addresses: ["100.84.12.9", "127.0.0.1"], tailscaleIp: "100.84.12.9" }));

  it("falls back to loopback with a warning", () => {
    const plan = pickBindAddresses("tailscale", {});
    expect(plan.warning).toMatch(/Tailscale/);
    expect(plan.addresses).toEqual(["127.0.0.1"]);
    expect(plan.tailscaleIp).toBeUndefined();
  });

  it("takes only a non-internal IPv4 inside 100.64.0.0/10, reported as 'IPv4' or 4", () => {
    const outside = {
      lo: [{ address: "100.64.0.1", family: "IPv4", internal: true }],
      v6: [{ address: "fd7a:115c:a1e0::1", family: "IPv6", internal: false }],
      below: [{ address: "100.63.255.255", family: "IPv4", internal: false }],
      above: [{ address: "100.128.0.1", family: "IPv4", internal: false }],
    };
    expect(pickBindAddresses("tailscale", outside).addresses).toEqual(["127.0.0.1"]);
    const numeric = { ts: [{ address: "100.127.255.254", family: 4, internal: false }] };
    expect(pickBindAddresses("tailscale", { ...outside, ...numeric })).toEqual({
      addresses: ["100.127.255.254", "127.0.0.1"],
      tailscaleIp: "100.127.255.254",
    });
  });

  it("prefers the Tailscale adapter over another interface in the same range", () => {
    const interfaces = {
      Cellular: [{ address: "100.70.1.2", family: "IPv4", internal: false }],
      Tailscale: [
        { address: "fd7a:115c:a1e0::9", family: "IPv6", internal: false },
        { address: "100.84.12.9", family: "IPv4", internal: false },
      ],
    };
    expect(pickBindAddresses("tailscale", interfaces).tailscaleIp).toBe("100.84.12.9");
    const linux = { usb0: interfaces.Cellular, tailscale0: interfaces.Tailscale };
    expect(pickBindAddresses("tailscale", linux).tailscaleIp).toBe("100.84.12.9");
  });

  it("loopback binds 127.0.0.1 only, even with Tailscale up", () => {
    const ts = { ts: [{ address: "100.84.12.9", family: "IPv4", internal: false }] };
    expect(pickBindAddresses("loopback", ts)).toEqual({ addresses: ["127.0.0.1"] });
  });

  it("an explicit address is bound with 127.0.0.1, once", () => {
    expect(pickBindAddresses("192.168.1.2", {})).toEqual({
      addresses: ["192.168.1.2", "127.0.0.1"],
    });
    expect(pickBindAddresses("127.0.0.1", {})).toEqual({ addresses: ["127.0.0.1"] });
    expect(pickBindAddresses("100.84.12.9", {})).toEqual({
      addresses: ["100.84.12.9", "127.0.0.1"],
      tailscaleIp: "100.84.12.9",
    });
  });

  it("a wildcard address is bound alone: it already covers 127.0.0.1", () => {
    expect(pickBindAddresses("0.0.0.0", {})).toEqual({ addresses: ["0.0.0.0"] });
    expect(pickBindAddresses("::", {})).toEqual({ addresses: ["::"] });
  });

  it("an empty bind never means every interface", () => {
    const plan = pickBindAddresses("  ", {});
    expect(plan.addresses).toEqual(["127.0.0.1"]);
    expect(plan.warning).toMatch(/bind/);
  });
});

describe("deferredListener", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers 503 in JSON until it is given the real listener, then forwards to it", async () => {
    const deferred = deferredListener();
    server.on("request", deferred.listener);

    const early = await fetch(`${base}/health`);
    expect(early.status).toBe(503);
    expect(early.headers.get("content-type")).toBe("application/json");
    expect(await early.json()).toEqual({ error: "starting" });

    deferred.use((req, res) => res.end(`real ${req.url}`));
    const late = await fetch(`${base}/health`);
    expect(late.status).toBe(200);
    expect(await late.text()).toBe("real /health");
  });
});

describe("listenAll", () => {
  const servers: Server[] = [];
  const twoAddresses = ["127.0.0.2", "127.0.0.1"];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  /** A server whose listen fails with `code`, as when its address cannot take the port. */
  function failingServer(code: string): Server {
    const server = createServer();
    server.listen = (() => {
      process.nextTick(() => server.emit("error", Object.assign(new Error(code), { code })));
      return server;
    }) as Server["listen"];
    return server;
  }

  it("listens on every address on one port, which the first picks when given 0", async () => {
    const port = await listenAll(twoAddresses, 0, () => createServer(), servers);
    expect(port).toBeGreaterThan(0);
    expect(servers.map((s) => s.address())).toEqual([
      expect.objectContaining({ address: "127.0.0.2", port }),
      expect.objectContaining({ address: "127.0.0.1", port }),
    ]);
  });

  it("with port 0, starts over once on a new port if a later address finds it taken", async () => {
    const made: Server[] = [];
    const create = () => {
      const server = made.length === 1 ? failingServer("EADDRINUSE") : createServer();
      made.push(server);
      return server;
    };
    const port = await listenAll(twoAddresses, 0, create, servers);
    expect(made).toHaveLength(4);
    expect(made[0]?.listening).toBe(false);
    expect(servers).toEqual([made[2], made[3]]);
    expect(servers.map((s) => (s.address() as AddressInfo).port)).toEqual([port, port]);
  });

  it("retries neither a given port nor another error; the caller closes the servers", async () => {
    const taken = listenAll(["127.0.0.1"], 2350, () => failingServer("EADDRINUSE"), servers);
    await expect(taken).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(servers).toHaveLength(1);

    let made = 0;
    const create = () => (++made === 2 ? failingServer("EADDRNOTAVAIL") : createServer());
    const other = listenAll(twoAddresses, 0, create, servers);
    await expect(other).rejects.toMatchObject({ code: "EADDRNOTAVAIL" });
    expect(made).toBe(2);
    expect(servers).toHaveLength(3);
  });
});
