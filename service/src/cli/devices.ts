import { formatAge, table } from "./format.js";
import type { CommandIo } from "./run.js";

interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt?: string;
}

/** Prints the paired phones. */
export async function runDevices(
  { stdout, client }: CommandIo,
  now: Date = new Date(),
): Promise<void> {
  const { devices } = await client.request<{ devices: DeviceInfo[] }>({ type: "device.list" });
  if (devices.length === 0) {
    stdout.write("No paired devices. Run `afk pair` to add one.\n");
    return;
  }
  const rows = devices.map((d) => [
    d.id,
    d.name,
    formatAge(d.createdAt, now),
    d.lastSeenAt === undefined ? "never" : `${formatAge(d.lastSeenAt, now)} ago`,
  ]);
  stdout.write(`${table([["ID", "NAME", "PAIRED", "LAST SEEN"], ...rows])}\n`);
}

/** Revokes a device token. */
export async function runUnpair(deviceId: string, { stdout, client }: CommandIo): Promise<void> {
  await client.request({ type: "device.remove", deviceId });
  stdout.write(`Unpaired ${deviceId}.\n`);
}
