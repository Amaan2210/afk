import type { Command } from "commander";
import { formatAge, table } from "./format.js";
import { parsePortOption, withDaemon, type ClientOptions, type CommandIo } from "./run.js";

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

export function registerDevicesCommands(program: Command): void {
  program
    .command("devices")
    .description("list the paired phones")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption)
    .action((opts: ClientOptions) => withDaemon(opts, (io) => runDevices(io)));
  program
    .command("unpair")
    .description("revoke a paired phone")
    .argument("<deviceId>", "the device id, as shown by `afk devices`")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption)
    .action((deviceId: string, opts: ClientOptions) =>
      withDaemon(opts, (io) => runUnpair(deviceId, io)),
    );
}
