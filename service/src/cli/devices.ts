import { formatAge, table } from "./format.js";
import type { CommandIo } from "./run.js";

interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt?: string;
}

/** Prints the paired phone. */
export async function runDevices(
  { stdout, client }: CommandIo,
  now: Date = new Date(),
): Promise<void> {
  const { devices } = await client.request<{ devices: DeviceInfo[] }>({ type: "device.list" });
  if (devices.length === 0) {
    stdout.write("No phone is paired. Run `afk pair` to pair one.\n");
    return;
  }
  const rows = devices.map((d) => [
    d.name,
    `${formatAge(d.createdAt, now)} ago`,
    d.lastSeenAt === undefined ? "never" : `${formatAge(d.lastSeenAt, now)} ago`,
  ]);
  stdout.write(`${table([["PHONE", "PAIRED", "LAST CONNECTED"], ...rows])}\n`);
}
