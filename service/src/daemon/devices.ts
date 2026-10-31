import { randomBytes } from "node:crypto";
import type { DaemonConfig, DeviceRecord } from "./config.js";
import { generateToken, hashToken, verifyToken } from "./tokens.js";

const NAME_MAX = 40;

/** A paired device as it is listed: everything but its token hash. */
export type DeviceInfo = Omit<DeviceRecord, "tokenHash">;

/**
 * The devices paired with the daemon, kept in its config. A device's token is handed out once, by
 * `add`; only its hash is stored. Every change is written through `save`, and undone in memory
 * when the save fails.
 */
export class DeviceStore {
  constructor(
    private readonly cfg: DaemonConfig,
    private readonly save: (c: DaemonConfig) => Promise<void>,
  ) {}

  /** Pairs a device named `name` (trimmed, 1–40 characters) and returns its token. */
  async add(name: string): Promise<{ id: string; token: string }> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
      throw new Error(`bad_request: a device name must be 1-${NAME_MAX} characters`);
    }
    const token = generateToken();
    const id = this.newId();
    const record: DeviceRecord = {
      id,
      name: trimmed,
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
    };
    this.cfg.devices.push(record);
    try {
      await this.save(this.cfg);
    } catch (err) {
      const at = this.cfg.devices.indexOf(record);
      if (at >= 0) this.cfg.devices.splice(at, 1);
      throw err;
    }
    return { id, token };
  }

  async remove(id: string): Promise<void> {
    const index = this.cfg.devices.findIndex((d) => d.id === id);
    if (index < 0) throw new Error(`not_found: no device ${id}`);
    const [record] = this.cfg.devices.splice(index, 1);
    try {
      await this.save(this.cfg);
    } catch (err) {
      this.cfg.devices.splice(index, 0, record);
      throw err;
    }
  }

  list(): DeviceInfo[] {
    return this.cfg.devices.map((d) => {
      const info: DeviceInfo = { id: d.id, name: d.name, createdAt: d.createdAt };
      if (d.lastSeenAt !== undefined) info.lastSeenAt = d.lastSeenAt;
      return info;
    });
  }

  /** `"local"` for the CLI's token, the device whose token it is, or undefined. */
  authenticate(token: string): DeviceRecord | "local" | undefined {
    if (verifyToken(token, this.cfg.localTokenHash)) return "local";
    return this.cfg.devices.find((d) => verifyToken(token, d.tokenHash));
  }

  /** Stamps the device's `lastSeenAt` before returning, then saves. */
  async markSeen(id: string): Promise<void> {
    const device = this.cfg.devices.find((d) => d.id === id);
    if (device === undefined) return;
    device.lastSeenAt = new Date().toISOString();
    await this.save(this.cfg);
  }

  /** `dev_` and 8 random lowercase hex characters, unique among the paired devices. */
  private newId(): string {
    for (;;) {
      const id = `dev_${randomBytes(4).toString("hex")}`;
      if (!this.cfg.devices.some((d) => d.id === id)) return id;
    }
  }
}
