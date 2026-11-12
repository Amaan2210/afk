import type { Session } from "../../src/protocol/index.js";
import { alreadyStopped, runUnpair, stopWarning, type UnpairIo } from "../../src/cli/unpair.js";

function fake(o: { phones?: string[]; states?: Session["state"][] } = {}): {
  io: UnpairIo;
  out: () => string;
  sent: () => string[];
  confirm: ReturnType<typeof vi.fn>;
} {
  let text = "";
  const sent: string[] = [];
  const closeListeners: (() => void)[] = [];
  const confirm = vi.fn(async (): Promise<boolean | undefined> => true);
  const io: UnpairIo = {
    stdout: { write: (s) => (text += s) },
    port: 2350,
    confirm,
    stopWaitMs: 20,
    client: {
      hello: { daemon: { version: "0", hostname: "h", platform: "p" } },
      sessions: async () => (o.states ?? []).map((state) => ({ state }) as Session),
      request: (async (msg: { type: string }) => {
        sent.push(msg.type);
        if (msg.type === "device.list") {
          return { devices: (o.phones ?? []).map((name) => ({ name })) };
        }
        // The daemon goes away once it has acked the stop.
        setTimeout(() => closeListeners.forEach((cb) => cb()), 1);
        return {};
      }) as UnpairIo["client"]["request"],
      onClose: (cb) => {
        closeListeners.push(cb);
        return () => undefined;
      },
    },
  };
  return { io, out: () => text, sent: () => sent, confirm };
}

describe("stopWarning", () => {
  it("names the phone and counts the running sessions", () => {
    expect(stopWarning(["Pixel"], 2)).toBe(
      "This stops AFK on this laptop:\n" +
        '  - the phone "Pixel" is unpaired\n' +
        "  - 2 running sessions will end, with whatever the agents are doing",
    );
    expect(stopWarning(["Pixel"], 1)).toContain("1 running session will end");
  });

  it("says so when there is no phone or no session", () => {
    expect(stopWarning([], 0)).toBe(
      "This stops AFK on this laptop:\n  - no phone is paired\n  - no session is running",
    );
  });
});

describe("runUnpair", () => {
  it("warns, asks, then stops the daemon and says how to pair again", async () => {
    const f = fake({ phones: ["Pixel"], states: ["working", "ended", "idle"] });
    expect(await runUnpair({}, f.io)).toBe(0);
    expect(f.confirm).toHaveBeenCalledExactlyOnceWith("Stop AFK? [y/N] ");
    expect(f.sent()).toEqual(["device.list", "daemon.stop"]);
    expect(f.out()).toContain("2 running sessions will end");
    expect(f.out()).toMatch(/AFK is stopped\. `afk pair` pairs your phone again\.\n$/);
  });

  it("changes nothing when the answer is no", async () => {
    const f = fake({ phones: ["Pixel"] });
    f.confirm.mockResolvedValue(false);
    expect(await runUnpair({}, f.io)).toBe(1);
    expect(f.sent()).toEqual(["device.list"]);
    expect(f.out()).toMatch(/Nothing was changed\.\n$/);
  });

  it("does not stop when it cannot ask, and names --yes", async () => {
    const f = fake();
    f.confirm.mockResolvedValue(undefined);
    expect(await runUnpair({}, f.io)).toBe(1);
    expect(f.sent()).toEqual(["device.list"]);
    expect(f.out()).toContain("--yes");
  });

  it("--yes stops without asking, still saying what ends", async () => {
    const f = fake({ phones: ["Pixel"], states: ["working"] });
    expect(await runUnpair({ yes: true }, f.io)).toBe(0);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.out()).toContain('the phone "Pixel" is unpaired');
    expect(f.sent()).toEqual(["device.list", "daemon.stop"]);
  });
});

describe("alreadyStopped", () => {
  it("says nothing is running, exit 0", () => {
    let text = "";
    expect(alreadyStopped({ write: (s) => (text += s) })).toBe(0);
    expect(text).toContain("AFK is not running");
  });
});
