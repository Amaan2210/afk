import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import type { ChatHub } from "../../src/daemon/agents/hub.js";
import { createHttpHandler, type HttpHandler } from "../../src/daemon/http.js";
import type { SessionRegistry } from "../../src/daemon/sessions/registry.js";

let server: Server;
let handler: HttpHandler;
let base: string;
let lines: Record<string, unknown>[];

const registry = {
  get: (id: string) => (id === "s_x" ? { session: { id, state: "working" } } : undefined),
} as unknown as SessionRegistry;

async function start(level: "debug" | "info"): Promise<void> {
  lines = [];
  const log = pino({ level }, { write: (line: string) => void lines.push(JSON.parse(line)) });
  handler = createHttpHandler({
    registry,
    hub: {} as ChatHub,
    version: "0.1.0",
    codexSessionsDir: "unused",
    log,
    startedAt: Date.now(),
  });
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  handler.dispose();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(body: unknown) {
  const res = await fetch(`${base}/hooks/dropped`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-afk-session": "s_x" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const dropped = () => lines.filter((l) => l.msg === "relay: a hook dropped its payload");

describe("POST /hooks/dropped", () => {
  it("logs the hook and the reason at debug level, which --verbose shows", async () => {
    await start("debug");
    const reason = "no input for 300 ms after 11 bytes, not valid JSON";
    expect(await post({ event: "Stop", reason })).toEqual({ status: 200, json: {} });
    expect(dropped()).toEqual([
      expect.objectContaining({ level: 20, sessionId: "s_x", event: "Stop", reason }),
    ]);
  });

  it("logs nothing without --verbose", async () => {
    await start("info");
    expect((await post({ event: "Stop", reason: "not valid JSON" })).status).toBe(200);
    expect(dropped()).toEqual([]);
  });

  it("rejects a body without an event and a reason", async () => {
    await start("debug");
    expect(await post({ event: "Stop" })).toEqual({
      status: 400,
      json: { error: "bad_request", message: "event and reason must be strings" },
    });
    expect(dropped()).toEqual([]);
  });
});
