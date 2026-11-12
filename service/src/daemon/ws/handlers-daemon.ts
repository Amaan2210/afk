import type { DaemonSettings } from "../../protocol/index.js";
import { listDirs } from "../fs.js";
import { CLOSE_UNAUTHORIZED } from "./context.js";
import { badRequest, WsError } from "./errors.js";
import type { HandlerMap } from "./handlers.js";

type DaemonType = "daemon.settings.get" | "daemon.settings.set" | "daemon.stop" | "fs.listDirs";

/** A timer longer than about 24.8 days fires at once, so the grace is capped well below that. */
const MAX_GRACE_MIN = 24 * 60;

/** C0 controls, DEL and C1 controls. */
function hasControlChar(text: string): boolean {
  return [...text].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 0x20 || (c >= 0x7f && c <= 0x9f);
  });
}

function checkSettings(patch: Partial<DaemonSettings>): void {
  if (patch.laptopName !== undefined && hasControlChar(patch.laptopName)) {
    throw badRequest("laptopName must not contain control characters");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "number" && value < 0) throw badRequest(`${key} must not be negative`);
  }
  if ((patch.keepAwakeGraceMin ?? 0) > MAX_GRACE_MIN) {
    throw badRequest(`keepAwakeGraceMin must be at most ${MAX_GRACE_MIN}`);
  }
}

export const daemonHandlers: Pick<HandlerMap, DaemonType> = {
  "daemon.settings.get"(conn, msg, { deps }) {
    conn.send({ type: "daemon.settings", id: msg.id, settings: deps.config.settings });
  },

  /** Saved, applied to keep-awake, answered, and announced to every other client. */
  async "daemon.settings.set"(conn, msg, ctx) {
    checkSettings(msg.settings);
    const { config, keepAwake } = ctx.deps;
    const previous = config.settings;
    const settings: DaemonSettings = { ...previous, ...msg.settings };
    // A blank name gives the laptop its own name back.
    const laptopName = settings.laptopName?.trim();
    if (laptopName === undefined || laptopName === "") delete settings.laptopName;
    else settings.laptopName = laptopName;
    config.settings = settings;
    try {
      await ctx.save();
    } catch (err) {
      if (config.settings === settings) config.settings = previous;
      throw err;
    }
    keepAwake.setEnabled(settings.keepAwake);
    keepAwake.setGraceMs(settings.keepAwakeGraceMin * 60_000);
    conn.send({ type: "daemon.settings", id: msg.id, settings });
    ctx.broadcast({ type: "daemon.settings", settings }, (c) => c !== conn);
  },

  /**
   * Unpairs the phone, then asks the daemon to stop, which ends every session. A phone that did
   * not ask is told it is no longer paired, so it stops reconnecting.
   */
  async "daemon.stop"(conn, msg, ctx) {
    const { requestStop } = ctx.deps;
    if (requestStop === undefined) throw new WsError("internal", "this daemon cannot be stopped");
    await ctx.devices.clear();
    conn.ack(msg.id);
    for (const c of ctx.clients()) {
      if (c !== conn && !c.isLocal) c.reject("unauthorized", "unpaired", CLOSE_UNAUTHORIZED);
    }
    const who = conn.isLocal ? "the CLI" : `the phone ${conn.device?.name ?? ""}`.trimEnd();
    // Once the ack has left.
    setImmediate(() => requestStop(`stop asked by ${who}`));
  },

  async "fs.listDirs"(conn, msg, { deps }) {
    const listing = await listDirs(msg.path, deps.recent);
    conn.send({ type: "fs.dirs", id: msg.id, ...listing });
  },
};
