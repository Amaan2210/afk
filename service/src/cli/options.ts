import { InvalidArgumentError } from "commander";

/** `afk daemon --port`: 0 picks a free port. */
export function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65_535) {
    throw new InvalidArgumentError("Expected a port number from 0 to 65535.");
  }
  return port;
}

/** `--port` of the commands that talk to a running daemon. */
export function parsePortOption(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new InvalidArgumentError("Expected a port number from 1 to 65535.");
  }
  return port;
}
