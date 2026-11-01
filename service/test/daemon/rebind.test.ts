import { createServer, type Server } from "node:http";
import pino from "pino";
import { closeServer, type InterfaceAddress } from "../../src/daemon/net.js";
import { listenWhenTailscaleAppears, planBind, type Rebinder } from "../../src/daemon/rebind.js";

const TAILSCALE = { Tailscale: [{ address: "127.0.0.2", family: "IPv4", internal: false }] };
const isTailscale = (address: string): boolean => address === "127.0.0.2";

function logger(): { log: pino.Logger; lines: { level: number; msg: string }[] } {
  const lines: { level: number; msg: string }[] = [];
  const log = pino({ level: "debug" }, { write: (line: string) => lines.push(JSON.parse(line)) });
  return { log, lines };
}

/** A server whose listen starts only once `release` is called, as a slow bind would. */
function slowServer(): { server: Server; release: () => void } {
  const server = createServer();
  const listen = server.listen.bind(server) as (...args: unknown[]) => Server;
  let release = (): void => undefined;
  server.listen = ((...args: unknown[]) => {
    release = () => void listen(...args);
    return server;
  }) as Server["listen"];
  return { server, release: () => release() };
}

/** A server whose listen fails with `code`. */
function failingServer(code: string): Server {
  const server = createServer();
  server.listen = (() => {
    process.nextTick(() => server.emit("error", Object.assign(new Error(code), { code })));
    return server;
  }) as Server["listen"];
  return server;
}

const rebinders: Rebinder[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(rebinders.splice(0).map((r) => r.stop()));
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("planBind", () => {
  it("does not wait for a bind other than tailscale, or when the address is there", async () => {
    const onWait = vi.fn();
    const slow = { startWaitMs: 10_000, startPollMs: 10_000 };
    expect(await planBind("loopback", { ...slow, interfaces: () => ({}) }, onWait)).toEqual({
      addresses: ["127.0.0.1"],
    });
    const up = { ...slow, interfaces: () => TAILSCALE, isTailscale };
    expect(await planBind("tailscale", up, onWait)).toMatchObject({ tailscaleIp: "127.0.0.2" });
    expect(onWait).not.toHaveBeenCalled();
  });
});

describe("listenWhenTailscaleAppears", () => {
  let network: NodeJS.Dict<InterfaceAddress[]>;
  beforeEach(() => {
    network = {};
  });

  it("a stop while the new server starts waits for it, closes it and never hands it over", async () => {
    const { log } = logger();
    const slow = slowServer();
    servers.push(slow.server);
    const onListening = vi.fn();
    const create = vi.fn(() => slow.server);
    const r = listenWhenTailscaleAppears({
      tailscale: { interfaces: () => network, isTailscale, reprobeMs: 10 },
      port: 0,
      create,
      onListening,
      log,
    });
    rebinders.push(r);
    network = TAILSCALE;
    await vi.waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 2000, interval: 5 });

    let stopped = false;
    const stopping = r.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);
    slow.release();
    await stopping;

    expect(slow.server.listening).toBe(false);
    expect(onListening).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not take a 100.64/10 address that appears on another adapter", async () => {
    const { log } = logger();
    const create = vi.fn(() => createServer());
    const onListening = vi.fn();
    rebinders.push(
      listenWhenTailscaleAppears({
        // A phone tethered on a carrier's CGNAT, say: in Tailscale's range, but not Tailscale.
        tailscale: {
          interfaces: () => ({ eth: [{ address: "100.70.1.2", family: "IPv4", internal: false }] }),
          reprobeMs: 5,
        },
        port: 0,
        create,
        onListening,
        log,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(create).not.toHaveBeenCalled();
    expect(onListening).not.toHaveBeenCalled();
  });

  it("a failed listen is logged and tried again at the next look", async () => {
    const { log, lines } = logger();
    const good = createServer();
    servers.push(good);
    const create = vi
      .fn<() => Server>()
      .mockReturnValueOnce(failingServer("EADDRNOTAVAIL"))
      .mockReturnValue(good);
    const onListening = vi.fn();
    rebinders.push(
      listenWhenTailscaleAppears({
        tailscale: { interfaces: () => TAILSCALE, isTailscale, reprobeMs: 10 },
        port: 0,
        create,
        onListening,
        log,
      }),
    );

    await vi.waitFor(() => expect(onListening).toHaveBeenCalledWith(good, "127.0.0.2"), {
      timeout: 2000,
      interval: 5,
    });
    expect(good.address()).toMatchObject({ address: "127.0.0.2" });
    expect(lines.map((l) => l.msg)).toEqual([
      "could not listen on the Tailscale address; will try again",
      "listening on the Tailscale address that appeared",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(create).toHaveBeenCalledTimes(2);
  });
});
