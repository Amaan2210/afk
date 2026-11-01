import type { Readable } from "node:stream";

/**
 * Reads a stream to its end as UTF-8, but gives up after `timeoutMs` and returns what arrived,
 * so a relay never hangs on a stdin nobody closes.
 */
export function readStdin(stream: Readable, timeoutMs = 500): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const finish = (): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", finish);
      stream.off("error", finish);
      stream.off("close", finish);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (c: Buffer | string): void => void chunks.push(Buffer.from(c));
    const timer = setTimeout(finish, timeoutMs);
    stream.on("data", onData);
    stream.once("end", finish);
    stream.once("error", finish);
    stream.once("close", finish);
  });
}

/** Parses JSON, or undefined when it is not valid JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
