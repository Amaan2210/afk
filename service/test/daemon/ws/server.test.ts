import os from "node:os";
import WebSocket from "ws";
import type { Pending, Stats } from "../../../src/protocol/index.js";
import type { WsDeps } from "../../../src/daemon/ws/server.js";
import { VERSION } from "../../../src/version.js";
import {
  LOCAL_TOKEN,
  PIXEL,
  PIXEL_TOKEN,
  TAILSCALE_IP,
  startHarness,
  type Harness,
} from "./harness.js";

let h: Harness;

/** Replaces the default harness with one built with `extra`. */
async function restart(extra: Partial<WsDeps>): Promise<void> {
  await h.stop();
  h = await startHarness(extra);
}

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.stop();
});

describe("handshake", () => {
  it("rejects a non-auth first frame and a bad token with error unauthorized, then closes", async () => {
    const early = await h.connect();
    early.send({ type: "session.kill", id: "r1", sessionId: "s_x" });
    expect(await early.closed).toMatchObject({ code: 4001 });
    expect(early.frames).toEqual([
      { type: "error", code: "unauthorized", message: expect.any(String) },
    ]);

    const bad = await h.connect();
    bad.send({ type: "auth", token: "wrong", protocol: 1, client: { kind: "cli", name: "x" } });
    expect(await bad.closed).toMatchObject({ code: 4001 });
    expect(bad.frames).toEqual([
      { type: "error", code: "unauthorized", message: expect.any(String) },
    ]);

    const garbage = await h.connect();
    garbage.ws.send("not json");
    expect(await garbage.closed).toMatchObject({ code: 4001 });
    expect(garbage.of("error")[0].code).toBe("unauthorized");
    expect(h.ws.clientCount()).toBe(0);
  });

  it("protocol mismatch → error protocol_mismatch", async () => {
    const c = await h.connect();
    c.send({ type: "auth", token: LOCAL_TOKEN, protocol: 2, client: { kind: "cli", name: "x" } });
    expect(await c.closed).toMatchObject({ code: 4002 });
    expect(c.frames).toEqual([
      { type: "error", code: "protocol_mismatch", message: expect.any(String) },
    ]);
  });

  it("auth with a device token → hello, sessions.snapshot, stats, daemon.settings in that order", async () => {
    const { session } = await h.session();
    const c = await h.client(PIXEL_TOKEN);
    expect(c.types()).toEqual(["hello", "sessions.snapshot", "stats", "daemon.settings"]);
    expect(c.of("hello")[0]).toEqual({
      type: "hello",
      protocol: 1,
      daemon: {
        version: VERSION,
        hostname: os.hostname(),
        platform: process.platform,
        tailscaleIp: TAILSCALE_IP,
      },
      device: { id: PIXEL.id, name: "Pixel" },
    });
    expect(c.of("sessions.snapshot")[0].sessions.map((s) => s.id)).toEqual([session.id]);
    expect(c.of("stats")[0]).toMatchObject({ ramUsedBytes: 12e9, keepAwakeActive: false });
    expect(c.of("daemon.settings")[0]).toEqual({
      type: "daemon.settings",
      settings: h.config.settings,
    });
    // lastSeenAt is stamped and saved.
    const device = h.config.devices.find((d) => d.id === PIXEL.id);
    expect(Date.parse(device?.lastSeenAt ?? "")).toBeGreaterThan(Date.now() - 10_000);
    await vi.waitFor(() => expect(h.saveConfig).toHaveBeenCalledWith(h.config));
    expect(h.ws.clientCount()).toBe(1);
  });

  it("auth with the local token → hello.device is the cli", async () => {
    const c = await h.client(LOCAL_TOKEN);
    expect(c.of("hello")[0].device).toEqual({ id: "local", name: "cli" });
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  it("closes a socket that sends no auth within the timeout", async () => {
    await restart({ authTimeoutMs: 30 });
    const c = await h.connect();
    expect(await c.closed).toMatchObject({ code: 4001 });
    expect(c.frames).toEqual([
      { type: "error", code: "unauthorized", message: expect.stringMatching(/auth/) },
    ]);
  });

  it("refuses an upgrade on any path but /ws", async () => {
    await expect(h.connect("/other")).rejects.toThrow(/404/);
  });

  it("an authenticated client gets bad_request for a malformed frame, with its id, and stays open", async () => {
    const c = await h.client();
    c.send({ type: "session.kill", id: "k1" }); // no sessionId
    c.send({ type: "nope", id: "k2" });
    c.ws.send("[1,2]");
    await vi.waitFor(() => expect(c.of("error")).toHaveLength(3));
    expect(c.of("error")).toEqual([
      { type: "error", id: "k1", code: "bad_request", message: expect.any(String) },
      { type: "error", id: "k2", code: "bad_request", message: expect.any(String) },
      { type: "error", code: "bad_request", message: expect.any(String) },
    ]);
    c.send({ type: "auth", token: LOCAL_TOKEN, protocol: 1, client: { kind: "cli", name: "x" } });
    await vi.waitFor(() => expect(c.of("error")).toHaveLength(4));
    expect(c.of("error")[3]).toMatchObject({ code: "bad_request" });
    expect(c.of("hello")).toHaveLength(1);
    expect(c.isOpen).toBe(true);
  });
});

describe("broadcasts", () => {
  it("notify from the registry is broadcast with title/body", async () => {
    const { session } = await h.session("claude");
    const c = await h.client();
    const name = session.name;

    h.registry.signal(session.id, { kind: "turn_end", lastMessage: "Schemas are done." });
    expect(await c.next("notify")).toEqual({
      type: "notify",
      event: "finished",
      sessionId: session.id,
      sessionName: name,
      title: `${name} finished`,
      body: "Schemas are done.",
    });

    const pending: Pending = { kind: "permission", id: "perm-1", tool: "Bash", summary: "rm x" };
    h.registry.signal(session.id, { kind: "pending", pending });
    expect(await c.next("notify", (n) => n.event === "needs_input")).toEqual({
      type: "notify",
      event: "needs_input",
      sessionId: session.id,
      sessionName: name,
      title: `${name} needs your input`,
      body: "rm x",
      pending,
    });

    h.registry.signal(session.id, { kind: "subagent_start" });
    h.registry.signal(session.id, { kind: "subagent_stop" });
    expect(await c.next("notify", (n) => n.event === "subagent_finished")).toMatchObject({
      title: `${name}: sub-agent finished`,
      body: "Schemas are done.",
    });
  });

  it("stats samples go to authenticated clients only", async () => {
    const authed = await h.client();
    const pending = await h.connect();
    const sample: Stats = {
      at: "2026-10-31T10:00:00.000Z",
      ramUsedBytes: 1,
      ramTotalBytes: 2,
      cpuPercent: 3,
      keepAwakeActive: true,
    };
    h.stats.emit("sample", sample);
    expect(await authed.next("stats", (s) => s.cpuPercent === 3)).toEqual({
      type: "stats",
      ...sample,
    });
    expect(pending.frames).toEqual([]);
  });

  it("unauthenticated sockets receive no broadcasts", async () => {
    const pending = await h.connect();
    const watcher = await h.client();
    const { session } = await h.session();
    await watcher.next("session.updated", (u) => u.session.id === session.id);
    expect(pending.frames).toEqual([]);
  });

  it("a send that throws for one client does not stop the event reaching the others", async () => {
    const { session } = await h.session("claude");
    const a = await h.client();
    const b = await h.client();
    for (const c of [a, b]) {
      expect(await c.request({ type: "chat.subscribe", sessionId: session.id })).toMatchObject({
        type: "ack",
      });
    }
    const send = WebSocket.prototype.send;
    let threw = 0;
    vi.spyOn(WebSocket.prototype, "send").mockImplementation(function (
      this: WebSocket,
      ...args: Parameters<WebSocket["send"]>
    ) {
      if (threw === 0 && String(args[0]).includes("chat.event")) {
        threw++;
        throw new Error("socket already closed");
      }
      return send.apply(this, args);
    });

    h.registry.signal(session.id, { kind: "turn_start" }); // the hub shows a turn marker
    const reached = await vi.waitFor(() => {
      const got = [a, b].filter((c) => c.of("chat.event").length > 0);
      expect(got).toHaveLength(1);
      return got[0];
    });
    expect(threw).toBe(1);
    expect(reached.of("chat.event")[0].event).toMatchObject({ kind: "turn" });
    expect(h.logs).toContainEqual(
      expect.objectContaining({ level: 40, client: expect.any(String), device: "local" }),
    );
    vi.restoreAllMocks();
    // Both clients carry on.
    for (const c of [a, b]) await c.sync();
  });

  it("a listener that fails is logged and never throws back into the emitter", async () => {
    const { session } = await h.session("claude");
    const c = await h.client();
    await c.request({ type: "chat.subscribe", sessionId: session.id });
    vi.spyOn(h.hub, "history").mockImplementation(() => {
      throw new Error("history unreadable");
    });
    expect(() => h.hub.emit("reset", { sessionId: session.id, threadId: "main" })).not.toThrow();
    expect(h.logs).toContainEqual(expect.objectContaining({ level: 40, event: "reset" }));
    vi.restoreAllMocks();
    h.hub.emit("reset", { sessionId: session.id, threadId: "main" });
    await vi.waitFor(() => expect(c.of("chat.snapshot")).toHaveLength(2));
  });

  it("a throwing handler becomes error internal for that request and the client carries on", async () => {
    const c = await h.client();
    const other = await h.client();
    vi.spyOn(h.registry, "kill").mockImplementation(() => {
      throw new TypeError("boom");
    });
    expect(await c.request({ type: "session.kill", sessionId: "s_any" })).toEqual({
      type: "error",
      id: expect.any(String),
      code: "internal",
      message: expect.any(String),
    });
    expect(h.logs).toContainEqual(expect.objectContaining({ level: 40, device: "local" }));
    await c.sync();
    expect(other.isOpen).toBe(true);
  });
});

describe("lifecycle", () => {
  it("terminates a client that stops answering pings and keeps one that answers", async () => {
    // Long enough that a busy test worker does not miss a pong between two beats.
    await restart({ heartbeatMs: 150 });
    const silent = await h.connect("/ws", { autoPong: false });
    await silent.auth(LOCAL_TOKEN);
    const lively = await h.client();
    let pings = 0;
    lively.ws.on("ping", () => pings++);
    expect((await silent.closed).code).toBe(1006); // terminated: no close frame
    await vi.waitFor(() => expect(pings).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    expect(lively.isOpen).toBe(true);
    expect(h.ws.clientCount()).toBe(1);
  });

  it("closes a socket that sends a frame over 1 MiB (1009) and keeps serving the others", async () => {
    const big = await h.client();
    const other = await h.client();
    big.ws.send("x".repeat(1024 * 1024 + 1));
    expect(await big.closed).toMatchObject({ code: 1009 });
    await other.sync();
    expect(h.ws.clientCount()).toBe(1);
  });

  it("close() closes every client with 1001 and resolves", async () => {
    const a = await h.client();
    const b = await h.client(PIXEL_TOKEN);
    const pending = await h.connect();
    await h.ws.close();
    expect(await a.closed).toMatchObject({ code: 1001 });
    expect(await b.closed).toMatchObject({ code: 1001 });
    expect(await pending.closed).toMatchObject({ code: 1001 });
    expect(h.ws.clientCount()).toBe(0);
    expect(h.registry.listenerCount("updated")).toBe(0);
    expect(h.hub.listenerCount("chat")).toBe(0);
    expect(h.stats.listenerCount("sample")).toBe(0);
  });
});
