import type { CommandClient } from "../../src/cli/client.js";
import { runPair, type PairIo } from "../../src/cli/pair.js";
import { CliError } from "../../src/cli/run.js";

function fake(tailscaleIp: string | undefined): {
  io: PairIo;
  out: () => string;
  err: () => string;
  request: ReturnType<typeof vi.fn>;
  promptName: ReturnType<typeof vi.fn>;
} {
  let text = "";
  let errText = "";
  const request = vi.fn(async () => ({ type: "ack", deviceId: "dev_1", token: "tok" }));
  const promptName = vi.fn(async (): Promise<string | undefined> => undefined);
  const client: CommandClient = {
    hello: { daemon: { version: "0", hostname: "desk", platform: "p", tailscaleIp } },
    sessions: async () => [],
    request: request as unknown as CommandClient["request"],
  };
  const io: PairIo = {
    stdout: { write: (s) => (text += s) },
    stderr: { write: (s) => (errText += s) },
    client,
    port: 2350,
    promptName,
    tailscaleIp: () => undefined,
    reachable: async () => false,
    tailscaleWaitMs: 40,
    listenWaitMs: 40,
    pollMs: 5,
  };
  return { io, out: () => text, err: () => errText, request, promptName };
}

describe("runPair", () => {
  it("--name Pixel prints the steps, a QR code and the three values to type", async () => {
    const f = fake("100.84.12.9");
    await runPair({ name: "Pixel" }, f.io);
    expect(f.request).toHaveBeenCalledWith({ type: "device.add", name: "Pixel" });
    expect(f.promptName).not.toHaveBeenCalled();
    const out = f.out();
    expect(out).toContain('Pair "Pixel" with this laptop (desk):');
    expect(out).toMatch(/Host {3}100\.84\.12\.9\n {2}Port {3}2350\n {2}Token {2}tok\n/);
    expect(out).toContain("shown only this once");
    // A QR block sits between the steps and the values.
    const qr = out.slice(out.indexOf("2. Scan"), out.indexOf("Host"));
    expect(qr.split("\n").length).toBeGreaterThan(5);
    expect(f.err()).toBe("");
  });

  it("puts the port the client connected on in what the phone scans", async () => {
    const f = fake("100.84.12.9");
    f.io.port = 4321;
    await runPair({ name: "x" }, f.io);
    expect(f.out()).toContain("Port   4321");
  });

  it("asks for the name when --name is absent and uses the answer", async () => {
    const f = fake("100.84.12.9");
    f.promptName.mockResolvedValue("  Galaxy ");
    await runPair({}, f.io);
    expect(f.request).toHaveBeenCalledWith({ type: "device.add", name: "Galaxy" });
  });

  it.each([undefined, "", "   "])('falls back to "phone" when the answer is %j', async (a) => {
    const f = fake("100.84.12.9");
    f.promptName.mockResolvedValue(a);
    await runPair({}, f.io);
    expect(f.request).toHaveBeenCalledWith({ type: "device.add", name: "phone" });
  });

  it("with Tailscale off, says so, waits for it and for the daemon to listen, then pairs", async () => {
    const f = fake(undefined);
    let looks = 0;
    f.io.tailscaleIp = () => (++looks > 2 ? "100.70.1.2" : undefined);
    let probes = 0;
    const reachable = vi.fn(async () => ++probes > 1);
    f.io.reachable = reachable;
    await runPair({ name: "Pixel" }, f.io);
    expect(f.err()).toMatch(/Tailscale is not running on this laptop.*Waiting for Tailscale/s);
    expect(f.err()).toContain("Tailscale is up (100.70.1.2).");
    expect(reachable).toHaveBeenLastCalledWith("100.70.1.2", 2350);
    expect(f.out()).toContain("Host   100.70.1.2");
  });

  it("with Tailscale up but the daemon not on it yet, waits without the notice", async () => {
    const f = fake(undefined);
    f.io.tailscaleIp = () => "100.70.1.2";
    f.io.reachable = async () => true;
    await runPair({ name: "Pixel" }, f.io);
    expect(f.err()).toBe("");
    expect(f.out()).toContain("Host   100.70.1.2");
  });

  it("gives up, pairing nothing, when Tailscale never comes up", async () => {
    const f = fake(undefined);
    const err = await runPair({ name: "Pixel" }, f.io).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toMatch(/Tailscale did not come up.*run `afk pair` again/);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.out()).toBe("");
  });

  it("gives up, pairing nothing, when the daemon never listens on the address", async () => {
    const f = fake(undefined);
    f.io.tailscaleIp = () => "100.70.1.2";
    const err = await runPair({ name: "Pixel" }, f.io).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toMatch(
      /not listening on the Tailscale address 100\.70\.1\.2:2350/,
    );
    expect((err as CliError).message).toMatch(/`bind`.*`tailscale` \(the default\)/);
    expect(f.request).not.toHaveBeenCalled();
  });
});
