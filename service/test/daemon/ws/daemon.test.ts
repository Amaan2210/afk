import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashToken } from "../../../src/daemon/tokens.js";
import { LOCAL_TOKEN, PIXEL, PIXEL_TOKEN, startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.stop();
});

describe("daemon settings", () => {
  it("daemon.settings.set persists and toggles keep-awake", async () => {
    const graceSpy = vi.spyOn(h.keepAwake, "setGraceMs");
    h.keepAwake.update(["working"]);
    expect(h.power.held).toBe(true);
    const a = await h.client();
    const b = await h.client(PIXEL_TOKEN);
    h.saveConfig.mockClear();

    a.send({ type: "daemon.settings.set", id: "set1", settings: { keepAwake: false } });
    const reply = await a.next("daemon.settings", (s) => s.id === "set1");
    const settings = { keepAwake: false, keepAwakeGraceMin: 10, retentionHours: 24 };
    expect(reply).toEqual({ type: "daemon.settings", id: "set1", settings });
    expect(h.config.settings).toEqual(settings);
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
    expect(h.saveConfig.mock.calls[0][0].settings).toEqual(settings);
    expect(h.power.held).toBe(false);
    expect(graceSpy).toHaveBeenLastCalledWith(600_000);

    // Every other client is told, without the requester's id; the requester only gets its reply.
    await vi.waitFor(() => expect(b.of("daemon.settings")).toHaveLength(2));
    expect(b.of("daemon.settings")[1]).toEqual({ type: "daemon.settings", settings });
    await a.sync();
    expect(a.of("daemon.settings").filter((s) => s.id === undefined)).toHaveLength(1); // greeting

    a.send({
      type: "daemon.settings.set",
      id: "set2",
      settings: { keepAwake: true, keepAwakeGraceMin: 2 },
    });
    await a.next("daemon.settings", (s) => s.id === "set2");
    expect(h.power.held).toBe(true);
    expect(graceSpy).toHaveBeenLastCalledWith(120_000);
  });

  it("daemon.settings.get replies with the current settings", async () => {
    const c = await h.client();
    c.send({ type: "daemon.settings.get", id: "g1" });
    expect(await c.next("daemon.settings", (s) => s.id === "g1")).toEqual({
      type: "daemon.settings",
      id: "g1",
      settings: h.config.settings,
    });
  });

  it("rejects negative values and a grace over a day, changing nothing", async () => {
    const c = await h.client();
    const before = structuredClone(h.config.settings);
    for (const settings of [{ retentionHours: -1 }, { keepAwakeGraceMin: 1441 }]) {
      expect(await c.request({ type: "daemon.settings.set", settings })).toMatchObject({
        type: "error",
        code: "bad_request",
      });
    }
    expect(h.config.settings).toEqual(before);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });
});

describe("devices", () => {
  it("device.add is refused for a device token and allowed for the local token", async () => {
    const phone = await h.client(PIXEL_TOKEN);
    for (const msg of [
      { type: "device.add", name: "Tablet" },
      { type: "device.list" },
      { type: "device.remove", deviceId: PIXEL.id },
    ]) {
      expect(await phone.request(msg)).toMatchObject({ type: "error", code: "unauthorized" });
    }
    expect(phone.isOpen).toBe(true);
    expect(h.config.devices.map((d) => d.id)).toEqual([PIXEL.id]);

    const cli = await h.client(LOCAL_TOKEN);
    h.saveConfig.mockClear();
    const added = await cli.request({ type: "device.add", name: "  Pixel Tablet  " });
    expect(added).toEqual({
      type: "ack",
      id: added.id,
      deviceId: expect.stringMatching(/^dev_[a-z0-9]{8}$/),
      token: expect.any(String),
    });
    if (added.type !== "ack") throw new Error("device.add failed");
    const record = h.config.devices.find((d) => d.id === added.deviceId);
    expect(record).toEqual({
      id: added.deviceId,
      name: "Pixel Tablet",
      tokenHash: hashToken(String(added.token)),
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(h.config)).not.toContain(String(added.token));
    expect(h.saveConfig).toHaveBeenCalledWith(h.config);

    // The new token works.
    const tablet = await h.client(String(added.token));
    expect(tablet.of("hello")[0].device).toEqual({ id: added.deviceId, name: "Pixel Tablet" });
  });

  it("device.list returns the devices without token hashes; device.remove forgets one", async () => {
    const cli = await h.client();
    const listed = await cli.request({ type: "device.list" });
    expect(listed).toEqual({
      type: "ack",
      id: listed.id,
      devices: [{ id: PIXEL.id, name: "Pixel", createdAt: PIXEL.createdAt }],
    });

    expect(await cli.request({ type: "device.remove", deviceId: "dev_none" })).toMatchObject({
      type: "error",
      code: "not_found",
    });
    expect(await cli.request({ type: "device.remove", deviceId: PIXEL.id })).toMatchObject({
      type: "ack",
    });
    expect(h.config.devices).toEqual([]);
    const refused = await h.connect();
    refused.send({
      type: "auth",
      token: PIXEL_TOKEN,
      protocol: 1,
      client: { kind: "android", name: "p" },
    });
    expect(await refused.closed).toMatchObject({ code: 4001 });
  });

  it("device.remove disconnects that device's open sockets", async () => {
    const phone = await h.client(PIXEL_TOKEN);
    const cli = await h.client();
    await cli.request({ type: "device.remove", deviceId: PIXEL.id });
    expect(await phone.closed).toMatchObject({ code: 4001 });
    expect(phone.of("error").at(-1)).toMatchObject({ code: "unauthorized" });
    expect(cli.isOpen).toBe(true);
  });

  it("device names are trimmed and must be 1-40 characters", async () => {
    const cli = await h.client();
    for (const name of ["", "   ", "x".repeat(41)]) {
      expect(await cli.request({ type: "device.add", name })).toMatchObject({
        type: "error",
        code: "bad_request",
      });
    }
    expect(await cli.request({ type: "device.add", name: "x".repeat(40) })).toMatchObject({
      type: "ack",
    });
    expect(h.config.devices).toHaveLength(2);
  });
});

describe("fs", () => {
  it("fs.listDirs → fs.dirs", async () => {
    await mkdir(join(h.dir, "projects", "beta"), { recursive: true });
    await mkdir(join(h.dir, "projects", "alpha"), { recursive: true });
    await h.recent.add(h.dir);
    const root = join(h.dir, "projects");
    const c = await h.client();

    c.send({ type: "fs.listDirs", id: "ls1", path: root });
    expect(await c.next("fs.dirs")).toEqual({
      type: "fs.dirs",
      id: "ls1",
      path: root,
      parent: dirname(root),
      dirs: [
        { name: "alpha", path: join(root, "alpha") },
        { name: "beta", path: join(root, "beta") },
      ],
      recent: [h.dir],
    });

    expect(await c.request({ type: "fs.listDirs", path: "relative" })).toMatchObject({
      type: "error",
      code: "bad_request",
    });
    expect(await c.request({ type: "fs.listDirs", path: join(root, "nope") })).toMatchObject({
      type: "error",
      code: "not_found",
    });
  });
});
