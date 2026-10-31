import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 2350;

export const SessionKindSchema = z.enum(["shell", "claude", "codex"]);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const SessionStateSchema = z.enum(["idle", "working", "needs_input", "finished", "ended"]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const ErrorCodeSchema = z.enum([
  "unauthorized",
  "protocol_mismatch",
  "bad_request",
  "not_found",
  "session_ended",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const PendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    id: z.string(),
    text: z.string(),
    multiSelect: z.boolean(),
    allowsText: z.boolean(),
    options: z.array(
      z.object({
        label: z.string(),
        description: z.string().optional(),
        recommended: z.boolean().optional(),
      }),
    ),
  }),
  z.object({
    kind: z.literal("permission"),
    id: z.string(),
    tool: z.string(),
    summary: z.string(),
  }),
]);
export type Pending = z.infer<typeof PendingSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string(),
  kind: SessionKindSchema,
  state: SessionStateSchema,
  createdAt: z.string(),
  lastActivityAt: z.string(),
  endedAt: z.string().optional(),
  exitCode: z.number().optional(),
  gitBranch: z.string().optional(),
  agentSessionId: z.string().optional(),
  lastMessage: z.string().optional(),
  subagentsRunning: z.number(),
  pending: PendingSchema.optional(),
});
export type Session = z.infer<typeof SessionSchema>;

export const ChatEventSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  at: z.string(),
  kind: z.enum(["user", "assistant", "tool", "subagent", "question", "permission", "turn"]),
  text: z.string().optional(),
  tool: z
    .object({
      name: z.string(),
      summary: z.string(),
      status: z.enum(["running", "ok", "error"]),
      input: z.string().optional(),
      result: z.string().optional(),
    })
    .optional(),
  subagent: z
    .object({
      threadId: z.string(),
      name: z.string(),
      task: z.string(),
      status: z.enum(["running", "done", "error"]),
      toolUses: z.number(),
    })
    .optional(),
  pending: PendingSchema.optional(),
  turn: z.object({ phase: z.enum(["start", "end"]) }).optional(),
});
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const StripSchema = z.object({
  at: z.string(),
  model: z.object({ id: z.string(), name: z.string() }).optional(),
  thinking: z.string().optional(),
  contextUsedPct: z.number().optional(),
  contextSize: z.number().optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  fiveHourPct: z.number().optional(),
  sevenDayPct: z.number().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
});
export type Strip = z.infer<typeof StripSchema>;

export const StatsSchema = z.object({
  at: z.string(),
  ramUsedBytes: z.number(),
  ramTotalBytes: z.number(),
  cpuPercent: z.number(),
  keepAwakeActive: z.boolean(),
});
export type Stats = z.infer<typeof StatsSchema>;

export const DaemonSettingsSchema = z.object({
  keepAwake: z.boolean(),
  keepAwakeGraceMin: z.number(),
  retentionHours: z.number(),
});
export type DaemonSettings = z.infer<typeof DaemonSettingsSchema>;
