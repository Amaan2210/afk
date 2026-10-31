import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJsonSchema } from "../../src/protocol/emit-schema.js";
import { isClientType, parseClientMessage, parseServerMessage } from "../../src/protocol/index.js";

const protocolDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol");
const examplesDir = join(protocolDir, "examples");
const exampleFiles = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => join(examplesDir, f));

it.each(exampleFiles)("example %s parses with the matching schema", (file) => {
  const msg = JSON.parse(readFileSync(file, "utf8"));
  const parsed = isClientType(msg.type) ? parseClientMessage(msg) : parseServerMessage(msg);
  expect(parsed.type).toBe(msg.type);
});

it("has an example for every message type", () => {
  const types = [
    "auth",
    "session.create",
    "session.kill",
    "session.resume",
    "session.rename",
    "pty.subscribe",
    "pty.unsubscribe",
    "pty.input",
    "pty.resize",
    "chat.subscribe",
    "chat.unsubscribe",
    "pending.answer",
    "fs.listDirs",
    "daemon.settings.get",
    "daemon.settings.set",
    "device.add",
    "device.list",
    "device.remove",
    "hello",
    "ack",
    "error",
    "sessions.snapshot",
    "session.updated",
    "session.removed",
    "stats",
    "daemon.settings",
    "pty.snapshot",
    "pty.data",
    "pty.resized",
    "chat.snapshot",
    "chat.event",
    "strip.update",
    "notify",
    "fs.dirs",
  ];
  const seen = new Set(
    exampleFiles.map((f) => (JSON.parse(readFileSync(f, "utf8")) as { type: string }).type),
  );
  expect(types.filter((t) => !seen.has(t))).toEqual([]);
});

it("committed JSON schema matches the emitted schema", () => {
  const committed = JSON.parse(readFileSync(join(protocolDir, "afk-protocol.schema.json"), "utf8"));
  expect(committed).toEqual(buildJsonSchema());
});
