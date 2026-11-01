# Architecture

How the daemon and CLI in `service/src` fit together. The behaviour is specified in
[the design spec](superpowers/specs/2026-10-30-afk-design.md) and the wire format in
[the protocol](../protocol/protocol.md); this file says where each part lives and how data moves
between them.

## Data flow

A client (the `afk` CLI or the phone) connects to the daemon's WebSocket and sends requests
(`session.create`, `pty.input`, ...). The registry creates a session: a PowerShell in a pseudo-
terminal, started with a per-session profile, into which the agent's launch line is typed. The
agent runs with per-session hooks and a status line (Claude Code) or notify program (Codex) that
call back into `afk` (`afk hook`, `afk statusline`, `afk exec`), which post to the daemon's
loopback HTTP routes. Those posts become signals for the session's state machine. In parallel, the
chat hub tails the agent's own transcript or rollout file. Everything that changes is broadcast
over the WebSocket to the clients subscribed to it.

## Foundations: `paths`, `config`, `logger`, `tokens`, `devices`

`paths.ts` decides where AFK keeps its files: `%LOCALAPPDATA%\afk` on Windows (`~/.config/afk`
elsewhere), holding `config.json`, `local-token`, `daemon.lock`, `recent-folders.json`, `logs/` and
`sessions/` (one folder per session, with its generated profile). `config.ts` loads `config.json`
over the defaults, keeps unknown keys, and writes atomically by temp file and rename. `tokens.ts`
makes 32-byte random tokens and compares them in constant time against stored sha256 hashes: only
hashes are persisted, for the paired devices (`devices.ts`, which hands a token out once, on
`add`) and for the local token the CLI uses on loopback. `logger.ts` is a pino JSON-lines logger
writing `logs/afk-YYYY-MM-DD.log`, and to stdout too with `--verbose`.

## Sessions: `sessions/`

`registry.ts` is the daemon's list of sessions. It creates, kills, renames and resumes them, keeps
live names unique (`name`, `name-2`, ...; ended sessions keep theirs), applies agent signals
through the pure reducer in `state.ts` (idle, working, needs_input, finished, ended), polls the git
branch (`git.ts`, which reads `.git` files and never runs git), and prunes ended sessions after the
retention window. `session-process.ts` is one session's terminal: every output chunk goes to a raw
ring buffer, to a headless xterm (`@xterm/headless`, serialized for late joiners) and to `onData`
subscribers. `pty.ts` spawns through node-pty, using node-pty's bundled ConPTY host rather than the
system's, and loads the native addon lazily so other platforms can import it. `shell.ts` picks
`pwsh` or Windows PowerShell and its arguments. `profile.ts` renders the session profile, which
defines `claude` and `codex` as functions routed through `afk exec` for that shell only.
`launch-line.ts` builds the line typed to start the agent, quoting for PowerShell. `answer.ts`
turns an answer from the phone into the keystrokes the agent's prompt expects, in chunks with
pauses between them. `record.ts` is the registry's per-session bookkeeping.

## Launch injection: `launch/`

`launch-spec.ts` decides what each agent gets: Claude Code a settings file passed with `--settings`
(`claude-settings.ts` renders the hooks and status line that call `afk hook` and `afk statusline`),
Codex a `-c notify=[...]` override. The user's own settings are never read or rewritten.
`resolve-binary.ts` finds the real `claude` or `codex` on `PATH`, skipping the afkdev package
itself.

## Agents: `agents/`

`hub.ts` (with `hub-session.ts` and `hub-sources.ts`) keeps each session's chat: per-thread event
histories built from the agent's own log, plus the latest status strip. `tail.ts` follows a JSONL
file by polling (`fs.watch` misses appends on Windows) and separates the lines replayed from the
file from those appended later; only the latter signal the session, so resuming an old conversation
does not replay a stale prompt. `claude/transcript.ts` turns a transcript into chat events,
`claude/subagents.ts` finds sub-agent transcripts and threads them, `claude/question.ts` reads an
AskUserQuestion, `claude/hooks.ts` maps hook payloads to signals and session meta, and
`claude/statusline.ts` maps the status-line payload to a strip. For Codex, `codex/rollout.ts`
does the same for a rollout file, `codex/locate.ts` finds that file by thread id or by folder and
start time, and `codex/notify.ts` maps the notify argument. `summarize.ts` writes the one-line
summaries on tool cards.

## HTTP routes: `http.ts`, `http-routes.ts`, `http-codex-locate.ts`

The loopback relays are one request listener with a route table: `GET /health`,
`POST /hooks/claude/:event`, `POST /hooks/codex`, `POST /statusline`, and
`POST /sessions/:id/agent-start` and `agent-exit`. A route names the session from the
`X-AFK-Session` header or its path, and reads a JSON body of at most 1 MB. Handlers flush the
transcript first so earlier lines come first, then apply the signals to the registry in order.
`http-codex-locate.ts` runs after Codex starts to find its rollout file before the first notify
names the thread.

## WebSocket API: `ws/`

`server.ts` upgrades `/ws` on every bound address and shares one set of clients, devices and config
saves between them. `client-conn.ts` is one socket: the handshake (`auth`, then `hello`, a sessions
snapshot, stats and settings), its pty and chat subscriptions, and the frames sent to it, with no
broadcast reaching a socket before it authenticates. `client-conn.ts` parses each incoming frame against the protocol schemas (`parseClientMessage`), and
`frames.ts` builds the outgoing ones, with terminal bytes as base64. `handlers.ts` dispatches each validated message to a handler by type,
grouped in `handlers-session.ts`, `-pty.ts`, `-chat.ts`, `-daemon.ts` and `-devices.ts`. A request
is answered exactly once, by its handler or with the error it threw (`errors.ts`). `answered.ts`
stops a double tap from typing an answer's keys twice. `broadcasts.ts` forwards the registry's,
hub's and stats sampler's events (session updates, pty data, chat events, strips, notifications) to
the clients that watch them.

## Machine state: `stats.ts`, `keepawake.ts`, `power-request.ts`

`stats.ts` samples the laptop's RAM and CPU on an interval for the phone's status bar.
`keepawake.ts` holds a power request while any session is `working` or `needs_input` and releases
it a grace period after the last one stops (both configurable in the daemon settings).
`power-request.ts` is the request itself: kernel32 `SetThreadExecutionState` through `koffi`,
loaded lazily, doing nothing off Windows.

## Startup and networking: `net.ts`, `lock.ts`, `rebind.ts`, `index.ts`

`index.ts` starts the daemon in dependency order and records what has started, so a failed start
and `stop()` undo exactly that, in reverse. `lock.ts` makes one daemon per config folder: it
listens on a named pipe (a socket on Linux) the OS frees when its holder exits, so no lock is ever
left stale; the lock file only records the pid for the "already running" message. `net.ts` finds
the machine's Tailscale address (the CGNAT range 100.64.0.0/10, on Tailscale's own adapter first).
`rebind.ts` plans where to listen for the `bind` setting: with `tailscale` and no address yet it
waits up to 30 seconds, then falls back to loopback, and afterwards looks for the address and
starts listening on it when it appears. `fs.ts` backs the phone's folder picker (recent folders and
directory listing).

## CLI: `cli.ts`, `cli/`

`cli.ts` registers the commands with commander. `run.ts`'s `withDaemon` is how every client command
connects: it reads the port from the config, connects with the local token (`client.ts`), runs the
command and sets the exit code (2 when no daemon runs). `launch.ts` creates a session and attaches;
`attach.ts` puts the window in raw mode, forwards keys and resizes, and renders output, with
`detach-detector.ts` watching for `Ctrl+]` then `d`, `conpty-filter.ts` dropping the pseudo-
console's win32-input-mode request, and `terminal-reset.ts` restoring the window on exit.
`session-watch.ts` tracks session updates so the exit code is the session's own. `ls`, `kill`,
`pair`, `devices` and the other commands are thin wrappers over requests. `service.ts` and
`schtasks.ts` install, query and remove the scheduled task that runs `afk daemon` from logon.
`exec.ts`, `hook.ts` and `statusline.ts` are the hidden relays that run inside sessions and post to
the daemon over loopback.
