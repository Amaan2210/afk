import { defaultConfig, type DaemonConfig } from "../../src/daemon/config.js";
import { DeviceStore } from "../../src/daemon/devices.js";
import { hashToken } from "../../src/daemon/tokens.js";

const LOCAL = "local-token";
let cfg: DaemonConfig;
let save: ReturnType<typeof vi.fn<(c: DaemonConfig) => Promise<void>>>;
let store: DeviceStore;

beforeEach(() => {
  cfg = { ...structuredClone(defaultConfig), localTokenHash: hashToken(LOCAL) };
  save = vi.fn(async () => undefined);
  store = new DeviceStore(cfg, save);
});

describe("DeviceStore", () => {
  it("add stores only the token's hash and returns the token once", async () => {
    const { id, token } = await store.add(" Pixel 8 ");
    expect(id).toMatch(/^dev_[0-9a-f]{8}$/);
    expect(cfg.devices).toEqual([
      { id, name: "Pixel 8", tokenHash: hashToken(token), createdAt: expect.any(String) },
    ]);
    expect(Number.isNaN(Date.parse(cfg.devices[0].createdAt))).toBe(false);
    expect(JSON.stringify(cfg)).not.toContain(token);
    expect(save).toHaveBeenCalledWith(cfg);
  });

  it("add gives every device its own id and token", async () => {
    const a = await store.add("a");
    const b = await store.add("b");
    expect(a.id).not.toBe(b.id);
    expect(a.token).not.toBe(b.token);
  });

  it("add rejects a name that is empty after trimming or longer than 40 characters", async () => {
    await expect(store.add("  ")).rejects.toThrow(/^bad_request:/);
    await expect(store.add("x".repeat(41))).rejects.toThrow(/^bad_request:/);
    expect(cfg.devices).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it("authenticate knows the local token, each device's token, and nothing else", async () => {
    const { id, token } = await store.add("Pixel");
    expect(store.authenticate(LOCAL)).toBe("local");
    expect(store.authenticate(token)).toMatchObject({ id, name: "Pixel" });
    expect(store.authenticate("guess")).toBeUndefined();
    expect(store.authenticate("")).toBeUndefined();
  });

  it("an empty local token hash authenticates nothing", () => {
    cfg.localTokenHash = "";
    expect(store.authenticate("")).toBeUndefined();
  });

  it("list leaves out token hashes; remove forgets a device and saves", async () => {
    const { id } = await store.add("Pixel");
    cfg.devices[0].lastSeenAt = "2026-10-31T10:00:00.000Z";
    expect(store.list()).toEqual([
      {
        id,
        name: "Pixel",
        createdAt: cfg.devices[0].createdAt,
        lastSeenAt: "2026-10-31T10:00:00.000Z",
      },
    ]);
    save.mockClear();
    await store.remove(id);
    expect(cfg.devices).toEqual([]);
    expect(save).toHaveBeenCalledWith(cfg);
    await expect(store.remove(id)).rejects.toThrow(/^not_found:/);
  });

  it("a failed save undoes add and remove", async () => {
    const { id } = await store.add("Pixel");
    const saved = structuredClone(cfg.devices);
    save.mockRejectedValue(new Error("disk full"));

    await expect(store.add("Tablet")).rejects.toThrow("disk full");
    expect(cfg.devices).toEqual(saved);

    await store.add("x").catch(() => undefined);
    cfg.devices.push({ id: "dev_last", name: "Last", tokenHash: "h", createdAt: "t" });
    const before = structuredClone(cfg.devices);
    await expect(store.remove(id)).rejects.toThrow("disk full");
    expect(cfg.devices).toEqual(before); // back at its index, ahead of dev_last
  });

  it("markSeen stamps lastSeenAt at once and saves", async () => {
    const { id } = await store.add("Pixel");
    save.mockClear();
    const saved = store.markSeen(id);
    expect(cfg.devices[0].lastSeenAt).toEqual(expect.any(String));
    await saved;
    expect(save).toHaveBeenCalledWith(cfg);
  });
});
