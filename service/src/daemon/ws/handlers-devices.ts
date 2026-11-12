import { CLOSE_UNAUTHORIZED } from "./context.js";
import { WsError } from "./errors.js";
import type { Handler, HandlerMap } from "./handlers.js";

type DeviceType = "device.add" | "device.list" | "device.remove";

/** Device management is for the CLI's local token; a device's own socket stays open. */
function localOnly<T extends DeviceType>(handler: Handler<T>): Handler<T> {
  return (conn, msg, ctx) => {
    if (!conn.isLocal) throw new WsError("unauthorized", "managing devices needs the local token");
    return handler(conn, msg, ctx);
  };
}

export const deviceHandlers: Pick<HandlerMap, DeviceType> = {
  /**
   * The token is in this reply only: the daemon keeps just its hash. The new phone replaces any
   * paired before, whose open sockets are closed.
   */
  "device.add": localOnly<"device.add">(async (conn, msg, ctx) => {
    const { id, token } = await ctx.devices.add(msg.name);
    for (const c of ctx.clients()) {
      if (!c.isLocal) c.reject("unauthorized", "another phone was paired", CLOSE_UNAUTHORIZED);
    }
    conn.ack(msg.id, { deviceId: id, token });
  }),

  "device.list": localOnly<"device.list">((conn, msg, ctx) => {
    conn.ack(msg.id, { devices: ctx.devices.list() });
  }),

  /** A removed device's open sockets are closed: its token no longer admits it. */
  "device.remove": localOnly<"device.remove">(async (conn, msg, ctx) => {
    await ctx.devices.remove(msg.deviceId);
    for (const c of ctx.clients()) {
      if (c.device?.id === msg.deviceId) {
        c.reject("unauthorized", "this device was removed", CLOSE_UNAUTHORIZED);
      }
    }
    conn.ack(msg.id);
  }),
};
