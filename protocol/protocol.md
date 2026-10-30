# AFK protocol v1

The contract between the laptop daemon (`afk daemon`) and its clients: the Android app and the `afk` CLI. The daemon's zod schemas in `service/src/protocol/` are the executable form of this document; `protocol/afk-protocol.schema.json` is generated from them, and `protocol/examples/*.json` are sample messages both sides validate against in tests.

## Transport

- **WebSocket** at `ws://<host>:<port>/ws`. Default port **2350** ("AFK" on a phone keypad). The daemon binds its Tailscale IPv4 and loopback; never `0.0.0.0` unless configured.
- **HTTP (loopback only)** at `http://127.0.0.1:<port>` for hook and status-line relays and `/health`.
- Text frames carry one JSON object each. Every object has a string `type`. Byte payloads (terminal I/O) are base64 strings in the `data` field.
- Requests that need a reply carry a client-chosen `id` (string). The daemon answers with `ack` or `error` carrying the same `id`. Events pushed by the daemon have no `id`.

## Handshake

1. Client connects and sends, as its first frame:
   ```json
   {"type":"auth","token":"<device token>","protocol":1,"client":{"kind":"android","name":"Pixel 8"}}
   ```
   `client.kind` is `android` or `cli`.
2. Daemon replies `hello`, then `sessions.snapshot`, then `stats`, then `daemon.settings`.
   ```json
   {"type":"hello","protocol":1,"daemon":{"version":"0.1.0","hostname":"AMAN-LAPTOP","platform":"win32","tailscaleIp":"100.84.12.9"},"device":{"id":"dev_8f3a","name":"Pixel 8"}}
   ```
3. Any frame before a successful `auth`, a bad token, or a protocol mismatch closes the socket with an `error` (`unauthorized` / `protocol_mismatch`).

Device tokens come from `afk pair`. The CLI uses a local token stored in the daemon config, readable only by the user.

## Shared types

```ts
type SessionKind  = "shell" | "claude" | "codex";
type SessionState = "idle" | "working" | "needs_input" | "finished" | "ended";

interface Session {
  id: string;                 // "s_" + 12 base32 chars
  name: string;               // defaults to the folder name
  cwd: string;
  kind: SessionKind;          // agent currently or most recently running
  state: SessionState;
  createdAt: string;          // ISO 8601
  lastActivityAt: string;
  endedAt?: string;
  exitCode?: number;
  gitBranch?: string;
  agentSessionId?: string;    // Claude session id or Codex thread id
  lastMessage?: string;       // ≤ 200 chars, for cards and notifications
  subagentsRunning: number;
  pending?: Pending;          // present only while state is "needs_input"
}

type Pending =
  | { kind: "question"; id: string; text: string; multiSelect: boolean; allowsText: boolean;
      options: { label: string; description?: string; recommended?: boolean }[] }
  | { kind: "permission"; id: string; tool: string; summary: string };

interface ChatEvent {
  id: string;                 // stable per transcript line
  threadId: string;           // "main" or a sub-agent thread id
  at: string;                 // ISO 8601
  kind: "user" | "assistant" | "tool" | "subagent" | "question" | "permission" | "turn";
  text?: string;              // user, assistant (markdown subset)
  tool?: { name: string; summary: string; status: "running" | "ok" | "error"; input?: string; result?: string };
  subagent?: { threadId: string; name: string; task: string; status: "running" | "done" | "error"; toolUses: number };
  pending?: Pending;          // question, permission
  turn?: { phase: "start" | "end" };
}

interface Strip {
  at: string;
  model?: { id: string; name: string };
  thinking?: string;
  contextUsedPct?: number;    // 0–100
  contextSize?: number;       // tokens
  costUsd?: number;
  durationMs?: number;
  fiveHourPct?: number;
  sevenDayPct?: number;
  tokensIn?: number;
  tokensOut?: number;
}

interface Stats {
  at: string;
  ramUsedBytes: number;
  ramTotalBytes: number;
  cpuPercent: number;         // 0–100
  keepAwakeActive: boolean;
}

interface DaemonSettings {
  keepAwake: boolean;         // default true
  keepAwakeGraceMin: number;  // default 10
  retentionHours: number;     // default 24
}
```

## Client → daemon

| `type` | Fields | Reply |
|---|---|---|
| `auth` | `token`, `protocol`, `client{kind,name}` | `hello` … |
| `session.create` | `id`, `cwd`, `kind`, `args: string[]`, `name?`, `prompt?` | `ack{sessionId}` |
| `session.kill` | `id`, `sessionId` | `ack` |
| `session.resume` | `id`, `sessionId` (an ended session with `agentSessionId`) | `ack{sessionId}` of the new session |
| `session.rename` | `id`, `sessionId`, `name` | `ack` |
| `pty.subscribe` | `id`, `sessionId`, `cols`, `rows` | `ack`, then `pty.snapshot`, then `pty.data` stream |
| `pty.unsubscribe` | `sessionId` | — |
| `pty.input` | `sessionId`, `data` (base64) | — |
| `pty.resize` | `sessionId`, `cols`, `rows` | — |
| `chat.subscribe` | `id`, `sessionId`, `threadId?` (default `"main"`) | `ack`, then `chat.snapshot`, then `chat.event` stream |
| `chat.unsubscribe` | `sessionId`, `threadId?` | — |
| `pending.answer` | `id`, `sessionId`, `pendingId`, `choiceIndices?: number[]`, `text?`, `decision?: "allow"\|"allow_always"\|"deny"` | `ack` |
| `fs.listDirs` | `id`, `path?` (absent = drives / roots) | `fs.dirs` |
| `daemon.settings.get` | `id` | `daemon.settings` |
| `daemon.settings.set` | `id`, `settings: Partial<DaemonSettings>` | `daemon.settings` |
| `device.add` *(local token only)* | `id`, `name` | `ack{deviceId, token}` — the token is returned once, never stored in clear |
| `device.list` *(local token only)* | `id` | `ack{devices: {id,name,createdAt,lastSeenAt?}[]}` |
| `device.remove` *(local token only)* | `id`, `deviceId` | `ack` |

`session.create` semantics: the daemon spawns the shell in `cwd`, then types the launch line. For `claude`: `claude <args…> [prompt]`; for `codex`: `codex <args…> [prompt]`; for `shell`: nothing (`args` and `prompt` must be empty). `prompt` is passed as the agent's positional first prompt, quoted.

`pending.answer` semantics: the daemon translates the answer into the keystrokes the agent's prompt expects, then clears `pending` when the agent confirms (hook or transcript) or after the next output. `text` without `choiceIndices` means a free-text answer typed into the composer.

## Daemon → client

| `type` | Fields |
|---|---|
| `hello` | `protocol`, `daemon{version,hostname,platform,tailscaleIp?}`, `device{id,name}` |
| `ack` | `id`, plus any result fields named above |
| `error` | `id?`, `code`, `message` |
| `sessions.snapshot` | `sessions: Session[]` |
| `session.updated` | `session: Session` |
| `session.removed` | `sessionId` |
| `stats` | `Stats` fields (every 5 s while any client is connected) |
| `daemon.settings` | `id?`, `settings: DaemonSettings` |
| `pty.snapshot` | `sessionId`, `cols`, `rows`, `data` (base64 of serialized screen + scrollback) |
| `pty.data` | `sessionId`, `data` (base64) |
| `pty.resized` | `sessionId`, `cols`, `rows` |
| `chat.snapshot` | `sessionId`, `threadId`, `events: ChatEvent[]` |
| `chat.event` | `sessionId`, `threadId`, `event: ChatEvent` |
| `strip.update` | `sessionId`, `strip: Strip` |
| `notify` | `event: "needs_input"\|"finished"\|"subagent_finished"`, `sessionId`, `sessionName`, `title`, `body`, `pending?` |
| `fs.dirs` | `id`, `path?`, `parent?`, `dirs: {name,path}[]`, `recent: string[]` |

Error codes: `unauthorized`, `protocol_mismatch`, `bad_request`, `not_found`, `session_ended`, `internal`.

## Loopback HTTP (relays)

All bodies are JSON; all responses are `200 {}` on success. Relays must exit 0 even if the daemon is unreachable, so an agent's hook never fails because of AFK.

| Route | Header | Body |
|---|---|---|
| `POST /hooks/claude/:event` | `X-AFK-Session: <session id>` | the hook's stdin JSON, verbatim. `:event` ∈ `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionEnd` |
| `POST /hooks/codex` | `X-AFK-Session` | the Codex `notify` JSON argument, verbatim |
| `POST /statusline` | `X-AFK-Session` | the status-line stdin JSON, verbatim |
| `POST /sessions/:id/agent-start` | — | `{"kind":"claude"\|"codex","pid":n}` — sent by `afk exec` just before it spawns the real agent |
| `POST /sessions/:id/agent-exit` | — | `{"code":n}` — sent by `afk exec` when the agent exits; the session returns to `idle` and keeps `kind` |
| `GET /health` | — | → `{"ok":true,"version":"…","uptimeSec":n}` |

`ChatEvent` delivery is an **upsert by `id`**: a tool event is sent once as `running` and again, with the same `id`, when its result arrives. Clients replace the earlier event in place.

## Versioning

`protocol` is an integer. Additive changes (new optional fields, new message types a client may ignore) keep the number. Anything else bumps it, and `hello`/`auth` mismatch is an error.
