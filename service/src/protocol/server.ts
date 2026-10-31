import { z } from "zod";
import {
  ChatEventSchema,
  DaemonSettingsSchema,
  ErrorCodeSchema,
  PendingSchema,
  SessionSchema,
  StatsSchema,
  StripSchema,
} from "./shared.js";

const sessionId = z.string();

export const HelloSchema = z.object({
  type: z.literal("hello"),
  protocol: z.number(),
  daemon: z.object({
    version: z.string(),
    hostname: z.string(),
    platform: z.string(),
    tailscaleIp: z.string().optional(),
  }),
  device: z.object({ id: z.string(), name: z.string() }),
});

// Result fields (sessionId, deviceId, token, devices) ride along via passthrough.
export const AckSchema = z.object({ type: z.literal("ack"), id: z.string() }).passthrough();

export const ErrorSchema = z.object({
  type: z.literal("error"),
  id: z.string().optional(),
  code: ErrorCodeSchema,
  message: z.string(),
});

export const SessionsSnapshotSchema = z.object({
  type: z.literal("sessions.snapshot"),
  sessions: z.array(SessionSchema),
});
export const SessionUpdatedSchema = z.object({
  type: z.literal("session.updated"),
  session: SessionSchema,
});
export const SessionRemovedSchema = z.object({ type: z.literal("session.removed"), sessionId });

export const StatsMessageSchema = StatsSchema.extend({ type: z.literal("stats") });

export const DaemonSettingsMessageSchema = z.object({
  type: z.literal("daemon.settings"),
  id: z.string().optional(),
  settings: DaemonSettingsSchema,
});

export const PtySnapshotSchema = z.object({
  type: z.literal("pty.snapshot"),
  sessionId,
  cols: z.number().int(),
  rows: z.number().int(),
  data: z.string(),
});
export const PtyDataSchema = z.object({ type: z.literal("pty.data"), sessionId, data: z.string() });
export const PtyResizedSchema = z.object({
  type: z.literal("pty.resized"),
  sessionId,
  cols: z.number().int(),
  rows: z.number().int(),
});

export const ChatSnapshotSchema = z.object({
  type: z.literal("chat.snapshot"),
  sessionId,
  threadId: z.string(),
  events: z.array(ChatEventSchema),
});
export const ChatEventMessageSchema = z.object({
  type: z.literal("chat.event"),
  sessionId,
  threadId: z.string(),
  event: ChatEventSchema,
});

export const StripUpdateSchema = z.object({
  type: z.literal("strip.update"),
  sessionId,
  strip: StripSchema,
});

export const NotifySchema = z.object({
  type: z.literal("notify"),
  event: z.enum(["needs_input", "finished", "subagent_finished"]),
  sessionId,
  sessionName: z.string(),
  title: z.string(),
  body: z.string(),
  pending: PendingSchema.optional(),
});

export const FsDirsSchema = z.object({
  type: z.literal("fs.dirs"),
  id: z.string(),
  path: z.string().optional(),
  parent: z.string().optional(),
  dirs: z.array(z.object({ name: z.string(), path: z.string() })),
  recent: z.array(z.string()),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  HelloSchema,
  AckSchema,
  ErrorSchema,
  SessionsSnapshotSchema,
  SessionUpdatedSchema,
  SessionRemovedSchema,
  StatsMessageSchema,
  DaemonSettingsMessageSchema,
  PtySnapshotSchema,
  PtyDataSchema,
  PtyResizedSchema,
  ChatSnapshotSchema,
  ChatEventMessageSchema,
  StripUpdateSchema,
  NotifySchema,
  FsDirsSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
