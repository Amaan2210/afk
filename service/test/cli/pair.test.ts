import type { CommandClient } from "../../src/cli/client.js";
import { runPair, type PairIo } from "../../src/cli/pair.js";
import { CliError } from "../../src/cli/run.js";

function fake(tailscaleIp: string | undefined): {
  io: PairIo;
  out: () => string;
  request: ReturnType<typeof vi.fn>;
  promptName: ReturnType<typeof vi.fn>;
} {
  let text = "";
  const request = vi.fn(async () => ({ type: "ack", deviceId: "dev_1", token: "tok" }));
  const promptName = vi.fn(async (): Promise<string | undefined> => undefined);
  const client: CommandClient = {
    hello: { daemon: { version: "0", hostname: "h", platform: "p", tailscaleIp } },
    sessions: async () => [],
    request: request as unknown as CommandClient["request"],
  };
  const io: PairIo = {
    stdout: { write: (s) => (text += s) },
    client,
    port: 2350,
    promptName,
  };
  return { io, out: () => text, request, promptName };
}

describe("runPair", () => {
  it("--name Pixel prints a QR and the JSON line", async () => {
    const f = fake("100.84.12.9");
    await runPair({ name: "Pixel" }, f.io);
    expect(f.request).toHaveBeenCalledWith({ type: "device.add", name: "Pixel" });
    expect(f.promptName).not.toHaveBeenCalled();
    const out = f.out();
    expect(out).toContain('"token":"tok"');
    expect(out).toContain('{"afk":1,"host":"100.84.12.9","port":2350,"token":"tok"}');
    // A QR block precedes the JSON line.
    const qr = out.slice(0, out.indexOf('{"afk"'));
    expect(qr.split("\n").length).toBeGreaterThan(5);
  });

  it("puts the port the client connected on in the payload", async () => {
    const f = fake("100.84.12.9");
    f.io.port = 4321;
    await runPair({ name: "x" }, f.io);
    expect(f.out()).toContain('"port":4321');
  });

  it("asks for the name when --name is absent and uses the answer", async () => {
    const f = fake("100.84.12.9");
    f.promptName.mockResolvedValue("  Galaxy ");
    await runPair({}, f.io);
    expect(f.request).toHaveBeenCalledWith({ type: "device.add", name: "Galaxy" });
  });

  it.each([undefined, "", "   "])('falls back to "device" when the answer is %j', async (a) => {
    const f = fake("100.84.12.9");
    f.promptName.mockResolvedValue(a);
    await runPair({}, f.io);
    expect(f.request).toHaveBeenCalledWith({ type: "device.add", name: "device" });
  });

  it("fails before adding a device when the daemon has no Tailscale address", async () => {
    const f = fake(undefined);
    const err = await runPair({ name: "Pixel" }, f.io).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe(1);
    // The daemon picks up a Tailscale address that appears; a restart would end every session.
    expect((err as CliError).message).toMatch(/Start Tailscale.*run `afk pair` again/s);
    // Only a daemon with bind "tailscale" looks for the address while it runs.
    expect((err as CliError).message).toMatch(/`bind` is `tailscale` \(the default\)/);
    expect((err as CliError).message).not.toMatch(/restart/);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.out()).toBe("");
  });
});
