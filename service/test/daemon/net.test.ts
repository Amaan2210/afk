import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deferredListener, pickBindAddresses } from "../../src/daemon/net.js";

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
