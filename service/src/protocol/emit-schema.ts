import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ClientMessageSchema } from "./client.js";
import { ServerMessageSchema } from "./server.js";
import {
  ChatEventSchema,
  DaemonSettingsSchema,
  SessionSchema,
  StatsSchema,
  StripSchema,
} from "./shared.js";

/** Build the JSON Schema for protocol v1. Key order is fixed, so the output is deterministic. */
export function buildJsonSchema(): object {
  const definitions = {
    ClientMessage: ClientMessageSchema,
    ServerMessage: ServerMessageSchema,
    Session: SessionSchema,
    ChatEvent: ChatEventSchema,
    Strip: StripSchema,
    Stats: StatsSchema,
    DaemonSettings: DaemonSettingsSchema,
  };
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(definitions)) {
    const body: Record<string, unknown> = { ...zodToJsonSchema(schema, { $refStrategy: "none" }) };
    delete body["$schema"];
    out[name] = body;
  }
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "AFK protocol v1",
    definitions: out,
  };
}

function main(): void {
  const target = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "protocol",
    "afk-protocol.schema.json",
  );
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(buildJsonSchema(), null, 2) + "\n");
  console.log(`wrote ${target}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
