import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { pairPayload, renderQr } from "./format.js";
import {
  CliError,
  parsePortOption,
  withDaemon,
  type ClientOptions,
  type CommandIo,
} from "./run.js";

const DEFAULT_NAME = "device";

export interface PairOptions extends ClientOptions {
  name?: string;
}

export interface PairIo extends CommandIo {
  /** Asks for a device name; undefined when input is not interactive. */
  promptName: () => Promise<string | undefined>;
}

/** Asks on the terminal for a device name; undefined when stdin is not a TTY. */
export async function promptNameOnTty(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(`Device name [${DEFAULT_NAME}]: `);
  } finally {
    rl.close();
  }
}

/**
 * Adds a device and prints what the phone scans: a QR code and the same payload as one JSON line.
 * The token in it is a secret shown once, on purpose; it goes to stdout and nowhere else.
 */
export async function runPair(opts: PairOptions, io: PairIo): Promise<void> {
  const { stdout, client } = io;
  // Check before adding, so a daemon the phone cannot reach does not leave an unused device.
  if (client.hello.daemon.tailscaleIp === undefined) {
    throw new CliError(
      "The daemon has no Tailscale address, so a phone cannot reach it (127.0.0.1 is this machine only). " +
        "Start Tailscale: the daemon listens on its address within about 30 s. Then run `afk pair` again.",
    );
  }
  const asked = opts.name ?? (await io.promptName());
  const name = asked?.trim() || DEFAULT_NAME;
  const { token } = await client.request<{ deviceId: string; token: string }>({
    type: "device.add",
    name,
  });
  const payload = pairPayload(client.hello, token, io.port);
  stdout.write(`${renderQr(payload)}\n`);
  stdout.write(`${JSON.stringify(payload)}\n`);
  stdout.write("Scan the QR code in the AFK app. The token is shown only this once.\n");
}

export function registerPairCommand(program: Command): void {
  program
    .command("pair")
    .description("pair a phone: shows a QR code for the AFK app to scan")
    .option("--name <name>", "the phone name (asked for if omitted)")
    .option("--port <n>", "the daemon port (default: the configured one)", parsePortOption)
    .action((opts: PairOptions) =>
      withDaemon(opts, (io) => runPair(opts, { ...io, promptName: promptNameOnTty })),
    );
}
