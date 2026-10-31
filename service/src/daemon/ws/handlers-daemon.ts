import type { DaemonSettings } from "../../protocol/index.js";
import { listDirs } from "../fs.js";
import { badRequest } from "./errors.js";
import type { HandlerMap } from "./handlers.js";

type DaemonType = "daemon.settings.get" | "daemon.settings.set" | "fs.listDirs";

/** A timer longer than about 24.8 days fires at once, so the grace is capped well below that. */
const MAX_GRACE_MIN = 24 * 60;

function checkSettings(patch: Partial<DaemonSettings>): void {
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

  async "fs.listDirs"(conn, msg, { deps }) {
    const listing = await listDirs(msg.path, deps.recent);
    conn.send({ type: "fs.dirs", id: msg.id, ...listing });
  },
};
