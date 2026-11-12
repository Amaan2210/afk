import { z } from "zod";
import { DaemonSettingsSchema, SessionKindSchema } from "./shared.js";

const id = z.string();
const sessionId = z.string();

export const AuthSchema = z.object({
  type: z.literal("auth"),
  token: z.string(),
  protocol: z.number(),
  client: z.object({ kind: z.enum(["android", "cli"]), name: z.string() }),
});

export const SessionCreateSchema = z.object({
  type: z.literal("session.create"),
  id,
  cwd: z.string(),
  kind: SessionKindSchema,
  args: z.array(z.string()),
  name: z.string().optional(),
  prompt: z.string().optional(),
});

export const SessionKillSchema = z.object({ type: z.literal("session.kill"), id, sessionId });
export const SessionResumeSchema = z.object({ type: z.literal("session.resume"), id, sessionId });
export const SessionRenameSchema = z.object({
  type: z.literal("session.rename"),
  id,
  sessionId,
  name: z.string(),
});

export const PtySubscribeSchema = z.object({
  type: z.literal("pty.subscribe"),
  id,
  sessionId,
  cols: z.number().int(),
  rows: z.number().int(),
});
export const PtyUnsubscribeSchema = z.object({ type: z.literal("pty.unsubscribe"), sessionId });
export const PtyInputSchema = z.object({
  type: z.literal("pty.input"),
  sessionId,
  data: z.string(),
});
export const PtyResizeSchema = z.object({
  type: z.literal("pty.resize"),
  sessionId,
  cols: z.number().int(),
  rows: z.number().int(),
});

export const ChatSubscribeSchema = z.object({
  type: z.literal("chat.subscribe"),
  id,
  sessionId,
  threadId: z.string().optional(),
});
export const ChatUnsubscribeSchema = z.object({
  type: z.literal("chat.unsubscribe"),
  sessionId,
  threadId: z.string().optional(),
});

export const PendingAnswerSchema = z.object({
  type: z.literal("pending.answer"),
  id,
  sessionId,
  pendingId: z.string(),
  choiceIndices: z.array(z.number().int()).optional(),
  text: z.string().optional(),
  decision: z.enum(["allow", "allow_always", "deny"]).optional(),
});

export const FsListDirsSchema = z.object({
  type: z.literal("fs.listDirs"),
  id,
  path: z.string().optional(),
});

export const DaemonSettingsGetSchema = z.object({ type: z.literal("daemon.settings.get"), id });
export const DaemonSettingsSetSchema = z.object({
  type: z.literal("daemon.settings.set"),
  id,
  settings: DaemonSettingsSchema.partial(),
});

/**
 * Unpairs the phone, ends every session and stops the daemon. Accepted from the CLI and from the
 * paired phone (its Unpair).
 */
export const DaemonStopSchema = z.object({ type: z.literal("daemon.stop"), id });

// device.* are accepted only on the local (CLI) token; the daemon enforces that, not the schema.
export const DeviceAddSchema = z.object({ type: z.literal("device.add"), id, name: z.string() });
export const DeviceListSchema = z.object({ type: z.literal("device.list"), id });
export const DeviceRemoveSchema = z.object({
  type: z.literal("device.remove"),
  id,
  deviceId: z.string(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  AuthSchema,
  SessionCreateSchema,
  SessionKillSchema,
  SessionResumeSchema,
  SessionRenameSchema,
  PtySubscribeSchema,
  PtyUnsubscribeSchema,
  PtyInputSchema,
  PtyResizeSchema,
  ChatSubscribeSchema,
  ChatUnsubscribeSchema,
  PendingAnswerSchema,
  FsListDirsSchema,
  DaemonSettingsGetSchema,
  DaemonSettingsSetSchema,
  DaemonStopSchema,
  DeviceAddSchema,
  DeviceListSchema,
  DeviceRemoveSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

const clientTypes: ReadonlySet<string> = new Set(
  ClientMessageSchema.options.map((o) => o.shape.type.value),
);

/** True when `type` names a client-to-daemon message. */
export function isClientType(type: string): boolean {
  return clientTypes.has(type);
}
