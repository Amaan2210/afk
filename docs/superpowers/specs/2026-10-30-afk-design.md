# AFK — Design

**Date:** 2026-10-30
**Status:** Draft for approval
**Repo:** `git@github.com:AmaanKhan63/afk.git`

AFK is a remote control for terminal-based AI coding agents. You start Claude Code or Codex on your laptop with `afk claude …` or `afk codex …`, walk away, and from an Android phone you see exactly what the laptop terminal shows, get notified when the agent needs you or finishes, answer it, and start new sessions in any folder. Everything runs on your own machines over Tailscale. No accounts, no cloud, no cost.

This document is the approved description of what gets built. A builder should be able to plan from it without going back to the author. Decisions made in conversation are recorded as such; decisions the author made on their own are marked **(author's call)**; everything else is left to the builder.

---

## 1. Why this exists

The author runs Claude Code and Codex on a Windows 11 laptop, assigns a task, and goes to do other work. The pain:

1. Constantly checking the laptop to see whether the task finished or is waiting for input.
2. A Telegram hook tells them *that* something happened, but they still have to be at the laptop to answer or to start the next task.
3. Claude Code's built-in remote control doesn't show what the model is doing in enough detail, doesn't notify well, can't navigate sub-agents, and can't open a new terminal.
4. tmux + Tailscale would solve the plumbing, but a raw terminal on a phone is cramped and ugly, and tmux doesn't run on native Windows anyway.

AFK is the phone app and the laptop service that solve all four, built well enough to open-source.

## 2. Goals, non-goals, anti-goals

### Goals

- **Faithful terminal.** The phone shows the same bytes the laptop terminal shows. Nothing is hidden.
- **Readable chat view.** The same session rendered as a conversation: messages, tool calls as one-line cards, sub-agents as a navigable tree, questions as buttons.
- **Both views, one session.** Tabs inside a session. Input from either view goes to the same terminal.
- **Start anything from the phone.** New session in any folder: plain shell, Claude Code, or Codex, with flags and an optional first prompt.
- **Notifications that are enough on their own.** Needs-input and finished, with inline reply from the notification.
- **Status at a glance.** Laptop RAM and CPU on the home screen; a configurable status strip (model, thinking, context, cost, rate limits…) inside a session.
- **Keep the laptop awake** while agents are working.
- **Free and private.** Tailscale for the network, nothing else. No third-party push service.
- **Open-source quality.** Clear architecture, documented protocol, tests, CI, README, license. Someone else should be able to run it and contribute.

### Non-goals (v1)

- iOS, a web client, or a macOS/Linux daemon. The daemon should not *preclude* other platforms (node-pty is cross-platform) but v1 is only built and tested on Windows 11.
- Exposing the service to the public internet. Reachability is the tailnet's job.
- Replacing or weakening the agents' own permission systems.
- Playbooks / saved launch presets. Considered and declined.
- A clipboard bridge. Considered and declined; the composer is a normal text field and the terminal view supports long-press copy.

### Anti-goals (what would make this a failure even if it works)

- A chat UI that shows *less* than the terminal. The chat tab is a convenience, never the only view.
- Changing how the user's laptop terminal looks or behaves. The status line, hooks, and settings they already have must keep working untouched.
- Silently editing the user's global Claude Code or Codex configuration. Anything AFK needs is injected per session.
- Flaky notifications. A missed "needs your input" defeats the purpose.
- Vibe-coded structure. No giant files, no untyped protocol, no undocumented magic.

### Future (explicitly deferred, keep the design open to them)

- A "changes" / git-diff tab: what the agent touched, tap a file to read it. Deferred; for now the user asks the agent instead.
- Voice: dictate prompts, read summaries aloud.
- Session replay: scrub back through recorded terminal output.
- Multi-laptop: pair more than one machine.
- Web client reusing the same protocol; macOS/Linux daemon; Wear OS actions; alternative push transports (ntfy / FCM) for phones with aggressive battery killers.
- Persisted session list: the daemon keeps its session list in memory only, so a daemon restart empties the phone's list. Saving the list (with resume ids) to disk would let the phone resume sessions from before the restart.

## 3. Context and constraints

- **Laptop:** Windows 11 Home. Node 24. Claude Code 2.1.x installed natively (`claude.exe`), Codex CLI 0.166 installed via npm. PowerShell 5.1 present; PowerShell 7 may or may not be. WSL exists but is not used for agents and must not be required.
- **Phone:** Android. Android Studio and SDK 36/37 are installed on the laptop for building.
- **Network:** Tailscale on both devices (to be installed; free personal plan). The daemon listens only on the Tailscale interface and loopback.
- **Agents are usually run in skip-permissions / YOLO mode.** So the common "needs you" moments are: the agent finished its turn, or the agent asked a question with choices. Permission prompts must still be handled correctly when permissions are on.
- **The user's existing setup must keep working:** a `Notification`/`Stop`/`SubagentStart`/`SubagentStop` hook set in `~/.claude/settings.json` (Telegram), and a `statusLine` command (`npx -y ccstatusline@latest`). AFK adds to these per session; it never removes or rewrites them.
- **Cost:** zero. Every dependency is free and open source. Distribution is a GitHub Release APK and an npm package; no Play Store required.
- **Development context:** this folder *is* the repo (`remote-dev` locally, remote `AmaanKhan63/afk`); scaffold in place. A physical Android phone is available for testing and is the verification target for notifications, the foreground service, and the terminal view; the emulator is for CI and quick UI checks only. Tailscale will be installed on both devices before the Android phases, so the real network path can be exercised. Note: the laptop's SSH key identifies as a different GitHub account than the repo owner; the first push verifies access.

## 4. System overview

One monorepo, three parts, one documented protocol.

```
afk/
  service/     Node + TypeScript. npm package "afkdev", binary "afk".
               Daemon (sessions, PTYs, watchers, WebSocket API) and CLI (launcher,
               attach, pair, service install, hook/statusline relays).
  android/     Kotlin + Jetpack Compose. The phone app.
  protocol/    The WebSocket/HTTP protocol: a markdown spec and JSON Schemas.
               Source of truth for both sides.
  assets/      Vector icon, store art.
  docs/        Design docs, architecture notes, screenshots, this file.
  .github/     CI.
```

```
 Laptop (Windows 11)                                   Phone (Android)
 ┌───────────────────────────────────────────┐         ┌──────────────────────────┐
 │  afk daemon                               │  WS     │  AFK app                 │
 │   ├ Session registry + state machine      │◄───────►│   ├ Foreground service   │
 │   ├ PTY per session (node-pty / ConPTY)   │ Tailscale│   │   (socket, notifs)   │
 │   ├ Ring buffer of output per session     │         │   ├ Sessions / Session   │
 │   ├ Transcript watchers (Claude, Codex)   │         │   │   Terminal │ Chat     │
 │   ├ Hook + statusline receivers (HTTP)    │         │   ├ New session          │
 │   ├ System stats, keep-awake              │         │   └ Settings             │
 │   └ WebSocket API (token auth)            │         └──────────────────────────┘
 └───────▲──────────────▲────────────────────┘
         │ WS loopback  │ HTTP loopback
   afk claude …    hooks / statusline relay
   (attach client) (child processes of the agent)
```

The daemon owns every terminal. The laptop's own terminal window and the phone are both *clients* of the daemon. That is how a session survives closing the window, and how the phone shows exactly what the laptop shows.

## 5. Sessions

A **session** is one pseudo-terminal running a shell in a working directory, created and owned by the daemon.

- **Shell:** PowerShell 7 (`pwsh`) if found, otherwise Windows PowerShell 5.1. (Builder: detection and override via config.)
- **Launch command:** optional. For `afk claude --dangerously-skip-permissions`, the daemon creates the shell and types `claude --dangerously-skip-permissions<Enter>` into it. When the agent exits, the user lands back in the shell; the session is still alive. This is what makes "a session is a real shell you can `cd` and run `git` in" true.
- **Attributes:** `id`, `name` (defaults to the folder name, editable; unique among live sessions, a clash gets the first free `-2`, `-3`, …), `cwd`, `kind` (`shell` | `claude` | `codex`, from the launch command and refined by hooks), `state` (below), `createdAt`, `lastActivityAt`, `gitBranch` (polled, best effort), `agentSessionId` (Claude session id or Codex thread id, once known), `lastMessage` (short text for the card), `subagentCount`.
- **Output and late joiners:** the daemon runs a headless terminal emulator per session (e.g. `@xterm/headless` with the serialize addon) fed by the PTY, so it always holds the correct current screen, cursor, alternate-screen state, and scrollback **(author's call, on reviewer advice: raw-byte replay cuts escape sequences and loses TUI state, and the agents' TUIs redraw heavily)**. A client that connects later receives a serialized snapshot of the screen and scrollback, then live output. A bounded raw ring buffer **(author's call: 2 MB default, configurable)** is kept alongside for diagnostics and future replay. Forcing a resize-repaint on subscribe is the fallback if snapshots prove insufficient, not the primary mechanism.
- **Size:** the PTY has one size. Several clients may be attached at once (laptop window and phone). The PTY follows the size of the client that most recently connected or sent input; other clients render that grid as best they can (letterbox if they are larger, scroll if smaller). The headless terminal is resized in step with the PTY.
- **Agents started by hand inside a session are tracked too.** The daemon starts each session's shell with a session-scoped profile that defines `claude` and `codex` as PowerShell functions wrapping the launcher's injection logic (per-session `--settings` for Claude, `-c notify=…` for Codex, `AFK_SESSION_ID` in the environment). Typing `claude` in a phone-created shell session, or after a previous agent exited, therefore gets the same state, chat view, status strip, and notifications as `afk claude`. These functions exist only inside AFK sessions; the user's own shell profile and PATH are untouched. `kind` reflects the agent currently (or most recently) running in the session: a session is `shell` until an agent starts, `claude` or `codex` while one runs, and shows as a shell again with its history retained after the agent exits. Resume is simply `claude --resume <id>` typed into a session, which the app does on the user's behalf.
- **Input:** raw bytes from any client go to the PTY. The phone's composer sends the text followed by Enter. The key bar sends the right VT sequences. Answer buttons send whatever keystrokes the agent's prompt expects (see §7).
- **Lifecycle:** `running` from creation until the shell process exits → `ended`. `afk kill` / the app's Kill action terminates the process tree. Ended sessions stay in the list for a retention window **(author's call: 24 h)** with a **Resume** action when `agentSessionId` is known (`claude --resume <id>` / `codex resume <id>` in a fresh session in the same folder).
- **Daemon restart kills sessions.** Documented. Ended entries with resume ids remain so the user can pick up.

### Session state

| State | Meaning | Enters on | Leaves on |
|---|---|---|---|
| `idle` | Shell prompt, or agent waiting at its prompt with nothing pending | creation; user input after `finished` | agent starts a turn |
| `working` | Agent is processing a turn | Claude `UserPromptSubmit` / Codex `task_started` | `needs_input`, `finished`, `ended` |
| `needs_input` | A prompt is pending: permission, question with choices, Codex approval | Claude `Notification(permission_prompt)`, `PreToolUse(AskUserQuestion)`, Codex approval event | the prompt is answered (`PostToolUse`, next output, or next user input) |
| `finished` | Turn completed; agent is waiting for the next instruction | Claude `Stop` with no sub-agents still running / Codex `agent-turn-complete` | user sends input → `working` or `idle` |
| `ended` | Process exited | shell exit, kill | never |

`finished` carries the agent's last message so the card and the notification can show it. If that message ends with a question mark, the card says "Finished · asked you something".

Sub-agents: `SubagentStart`/`SubagentStop` maintain a per-session count. A `Stop` that fires while the count is above zero is a backgrounded-agent artefact and does **not** produce `finished` (this replicates the logic in the user's existing hook, which solved that false-positive).

## 6. The launcher and the daemon

### `afk` CLI

| Command | Behaviour |
|---|---|
| `afk claude [args…]` | Create a `claude` session in the current directory with those args, attach this window. |
| `afk codex [args…]` | Same for Codex. |
| `afk shell` | Create a plain shell session, attach. |
| `afk attach <name\|id>` | Attach this window to an existing session. |
| `afk ls` | List sessions and states. |
| `afk kill <name\|id>` | Kill a session. |
| `afk pair` | Print a QR code and text with host, port, and a new device token. |
| `afk devices` / `afk unpair <device>` | Manage paired phones. |
| `afk service install\|uninstall\|start\|stop\|status` | Register the daemon as a Scheduled Task that runs at logon, hidden. |
| `afk daemon` | Run the daemon in the foreground (what the task runs). |
| `afk hook <event>` | Internal. Reads the hook JSON from stdin, posts it to the daemon over loopback. |
| `afk statusline` | Internal. Reads the status-line JSON from stdin, posts it to the daemon, then pipes the same JSON to the user's original status-line command and relays its output. |

Launcher behaviour: if the daemon isn't running, start it (or print one clear line telling the user to run `afk service install`). Attach puts the window in raw mode, forwards keystrokes and resize events, renders output. Closing the window detaches; the session keeps running. An explicit detach chord exists **(author's call: `Ctrl+]` then `d`, configurable, printed once on attach)**. When the session ends, attach exits.

If the user wants plain `claude` to behave like `afk claude`, the README shows how to add a shim earlier on PATH. AFK never installs one on its own.

### Per-session injection (how the daemon learns what the agent is doing)

Claude Code:

- The launcher passes `--settings <path to a generated JSON>` so hooks and the status-line relay apply **to this session only**. The generated settings contain hooks for `SessionStart`, `UserPromptSubmit`, `PreToolUse` and `PostToolUse` (matcher `AskUserQuestion`), `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionEnd`, each invoking `afk hook <event>`. Hook commands must be robust to PATH and spaces (invoke via absolute `node` + absolute script path).
- The same generated settings set `statusLine` to `afk statusline`, which forwards the JSON to the daemon and then runs the user's own status-line command from their global settings, so the laptop terminal looks identical. Builder must verify that a `--settings` file takes precedence for `statusLine` and merges for hooks; if it does not, the fallback is to run the agent with the user's settings untouched and have `afk statusline` resolve the original command itself.
- The PTY environment carries `AFK_SESSION_ID` so hooks can identify their session without arguments.
- From `SessionStart` the daemon learns `session_id` and `transcript_path`, and starts tailing the transcript (`~/.claude/projects/<slug>/<session>.jsonl`) and the sub-agent files under `<session>/subagents/agent-*.jsonl`.

Codex:

- The launcher passes `-c notify=["<node>","<afk script>","hook","codex-notify"]` so `agent-turn-complete` (and approval events where Codex emits them) reach the daemon. Builder verifies the current key name against Codex 0.166's config reference; the TUI `notifications` list may also be relevant.
- The daemon locates the session's rollout file (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) by thread id from the notify payload or, before the first notification, by matching `cwd` and start time via `session_index.jsonl`. It tails the rollout for `task_started`, `task_complete`, `agent_message`, `user_message`, command and file-change events, and token counts.
- **Codex approvals are best effort in v1 (author's call).** `finished` and questions are the primary flows and must be reliable. If neither the notify hook nor the rollout file exposes a pending approval, v1 ships without Codex `needs_input` for approvals and the README says so; the user runs Codex in YOLO mode, so this does not affect the primary use. A PTY-output heuristic layer (prompt-pattern matching, idle detection) is future work and must not be needed for Claude, whose `Notification` hook reports `permission_prompt` explicitly.

Shell sessions have no agent; they are `idle` and show only the terminal tab.

### What the daemon exposes

- **WebSocket** on the Tailscale interface and loopback. Token required (first message or header). JSON messages with a `type` field. PTY output is sent as base64 inside JSON for v1 **(author's call; binary frames are a later optimisation and must not require a protocol redesign)**.
- **HTTP** on loopback only, for hooks and the status-line relay, plus `/health`.
- Message families (full detail lives in `protocol/`): `hello`, `sessions.snapshot`, `session.updated`, `session.removed`, `pty.data`, `pty.resized`, `chat.snapshot`, `chat.event`, `strip.update`, `question.pending`, `question.cleared`, `stats`, `notify`; and from clients `session.create`, `session.kill`, `session.resume`, `session.rename`, `pty.subscribe` (with replay), `pty.unsubscribe`, `pty.input`, `pty.resize`, `chat.subscribe`, `question.answer`, `fs.listDirs`, `daemon.settings.get/set` (keep-awake, retention).
- **Stats** every few seconds: RAM used/total, CPU %, hostname, Tailscale IP, daemon version.
- **Folder picker** backing: `fs.listDirs` returns child directories of a path plus a "recent folders" list the daemon keeps from past sessions. Never lists files; never leaves the user's drives.

### Pairing and security

- `afk pair` generates a random device token, stores its hash in the daemon config, and shows a QR code containing `{host, port, token}` (host = Tailscale IPv4; MagicDNS name included when available). The phone scans it or the user types it.
- Every socket connection must present a valid token. Tokens are per device and revocable.
- The daemon never binds `0.0.0.0` by default. Transport encryption is Tailscale's (WireGuard). No TLS in v1; the protocol must not prevent adding it.
- Hooks and the status-line relay use loopback only.

### Keep-awake

While any session is `working` or `needs_input`, the daemon holds a system power request (`SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`, display not required). It releases the request after all sessions have been `idle`/`finished`/`ended` for a grace period **(author's call: 10 min, configurable)**. The switch lives in the app's Settings and persists in the daemon config. Implementation via an FFI module with prebuilt binaries or a small PowerShell helper, builder's choice.

### Daemon housekeeping

Config and logs under `%LOCALAPPDATA%\afk\`. Log rotation. A `--verbose` flag. The daemon must start in under two seconds and idle at negligible CPU.

## 7. Chat view and questions

The daemon normalises both agents' transcripts into one event stream so the phone has a single renderer. Minimum event kinds:

- `user` — text the user sent.
- `assistant` — text the agent wrote (markdown; the phone renders a safe subset).
- `tool` — a tool call with `name`, a one-line `summary` (e.g. `Bash · npm test`, `Edit · src/auth.ts`), `status` (running / ok / error), and an expandable body (input and result, truncated with "show more").
- `subagent` — a sub-agent started: `name`, `task`, `status`, counts. Tapping opens that sub-agent's own event stream as a nested screen; nesting can repeat.
- `question` — a question with a list of choices, optional "recommended" flag, optional free-text allowed, and an `id`. Cleared when answered.
- `permission` — a pending permission prompt with the tool and a summary, when permissions are on.
- `turn` — turn boundaries, used for timestamps and "finished" dividers.

Answering: tapping a choice sends the keystrokes the agent's prompt expects. For Claude Code the builder must verify, against a real session, exactly which keys select and confirm an option in `AskUserQuestion` and in permission prompts (number key, arrows + Enter, or both), and handle multi-select. For Codex, map whatever its current prompt UI expects. "Other…" and free-text answers go through the composer. The daemon also marks the question as pending from the transcript, so even if a hook is missed the phone still sees it.

For Codex, the chat view is built from the rollout file and will be less rich than Claude's; that is acceptable and should be noted in the README.

## 8. Status strip

Source: the status-line JSON Claude Code already sends to the user's status-line command (model id and display name, context window size and used/remaining percentage, token totals, cost in USD and duration, five-hour and seven-day rate-limit usage where present, session id, cwd). The relay forwards every payload to the daemon; the daemon forwards a normalised `strip.update` to subscribed phones. For Codex: model and context percentage from the rollout; the rest shows as unavailable. Laptop memory is from the daemon's own stats, not from the status line.

Chips available: Model, Thinking level (when present in the payload or derivable), Context used %, Context size, Cost, 5h limit, 7d limit, Session time, Memory, Tokens in/out. The user picks which to show in Settings; order is the order listed. The strip sits **above the composer in both the Terminal and Chat tabs**, is one row high, scrolls sideways with no visible scrollbar, and takes no space when no agent is in the session.

## 9. Notifications

Delivered by the app itself. The app runs an Android foreground service holding the socket while paired; a low-priority persistent notification says which laptop it is connected to. Events from the daemon become notifications:

| Event | Channel | Default | Actions |
|---|---|---|---|
| `needs_input` (question) | Needs input (high) | on | the choices (up to three), Reply, Open |
| `needs_input` (permission) | Needs input (high) | on | Allow, Deny, Open |
| `finished` | Finished (default) | on | Reply (inline text), Open |
| sub-agent finished | Sub-agents (low) | off | Open |
| connection lost / restored | Connection (min) | on, silent | none |

Inline reply sends the text into that session as if typed in the composer. Tapping a notification opens that session. If the session is open in the foreground on the phone, its notifications are suppressed. One notification per session is updated in place rather than stacking.

Reconnection uses exponential backoff with jitter; the service survives app swipes; it respects Android 14+ foreground-service type rules. The README documents battery-optimisation exemptions for phones that kill background services, and names ntfy/FCM as a future alternative transport.

## 10. The Android app

**Stack:** Kotlin, Jetpack Compose, Material 3, Navigation Compose, kotlinx.serialization, OkHttp WebSocket, DataStore. Terminal rendering uses Termux's `terminal-emulator` and `terminal-view` (Apache-2.0), from JitPack (`com.github.termux.termux-app`) or vendored with license notices if the artifact is unreliable; builder's choice, documented in the README. Min SDK 26, target the latest stable. Min phone width 360 dp.

**Screens** (approved mockups live in `docs/design/mockups/`; they are the visual reference):

1. **Pairing.** Scan QR or enter host/port/token. Shows connection test result. Reachable later from Settings.
2. **Sessions (home).** Title, settings icon. A laptop strip: connection dot, hostname, RAM used/total with a bar that turns amber when memory is tight, CPU %. A search field (matches name, folder, branch, last message). Two groups of filter chips: state (All, Needs you, Working, Done) and agent (Claude, Codex, Shell), with counts. Session cards sorted `needs_input`, `finished`, `working`, `idle`, `ended`; each card has a state dot and label, name, time since activity, one monospace line of the latest message or terminal line, and tags: agent (coloured left edge and bold tag: terracotta Claude, violet Codex, teal Shell), sub-agent count, branch. Long-press: rename, kill, resume. FAB: New session.
3. **Session.** App bar with back, name, agent and state subtitle, overflow (rename, kill, resume, attach command to copy). Segmented tabs Terminal / Chat; swipe switches. **Terminal tab:** the terminal view filling the space; key bar (Esc, Tab, Ctrl, ↑, ↓, ←, →, Enter, keyboard toggle; Ctrl is sticky for one key); pinch to change font size; long-press to select and copy. **Chat tab:** the normalised event list, tool cards collapsed by default, sub-agent cards open a nested screen, question cards with buttons. **Both tabs:** the status strip above the composer, then the composer (multi-line text field, send button). Sending from either tab writes to the same terminal.
4. **Sub-agent thread.** Same renderer as the Chat tab, for one sub-agent, with its task as the title.
5. **New session.** Folder picker (browse directories from the laptop, recent folders first, type a path), agent segmented control (Claude, Codex, Shell), flag chips per agent (`--dangerously-skip-permissions`, `--resume`, `--model …` for Claude; Codex equivalents; none for shell), optional first prompt, Start.
6. **Settings.** Laptop (name, address, Keep awake switch with grace-period note, Unpair). Appearance (Theme: Graphite, Ember, Aurora, Phosphor, plus Dynamic on Android 12+; Mode: System, Light, Dark; Always dark terminal). Status strip chip picker. Notifications switches per channel. Terminal (font size, key bar on/off). About (version, licenses incl. Termux notice).

**Themes.** Four, each with light and dark, as approved: Graphite (neutral slate, blue accent), Ember (warm cream/charcoal, terracotta accent), Aurora (deep navy, violet-to-mint gradient accent), Phosphor (near-black, phosphor green, monospace UI, squarer corners). Plus Material You "Dynamic". Each theme defines a terminal colour scheme for both modes; "Always dark terminal" forces the dark scheme. Exact token values are in the mockups; the builder extracts them into a theme file.

**Icon.** The vector in `docs/design/mockups/03-tabs-themes-features.html` (chevron, arc, phone) becomes `assets/icon.svg` and the Android adaptive icon (foreground glyph, navy background, monochrome layer for themed icons).

**Behaviour details:** offline shows the last known list with a banner; every destructive action confirms; the app never auto-answers anything; state updates are animated subtly, no gratuitous motion; text scales with system font size; TalkBack labels on all controls.

## 11. Quality bar (open-source readiness)

- MIT license for the project **(author's call)**; Termux code under Apache-2.0 with NOTICE preserved.
- `README.md` with: what it is, screenshots, install (Tailscale on both devices; `npm i -g afkdev`; `afk service install`; `afk pair`; APK from Releases), usage, how it works, limitations (daemon restart ends sessions; Codex chat view is thinner; Windows-only daemon for now), contributing.
- `protocol/` is the single source of truth; both sides validate against it; a protocol version is exchanged in `hello`.
- **Service tests (vitest):** session state machine; Claude transcript normaliser against redacted fixtures taken from real transcripts, including sub-agent files; Codex rollout normaliser against fixtures; status-line relay; protocol validation; an integration test that spawns a real PowerShell PTY on Windows CI, types a command, and reads the output.
- **Android tests:** unit tests for protocol parsing, state reducers, and view-models; at least one Compose UI test for the sessions list; a manual QA checklist in `docs/`.
- **CI:** service lint + test on `windows-latest` (and `ubuntu-latest` for the non-PTY parts); Android assemble + unit tests; a release workflow that attaches the APK and publishes the npm package on a tag.
- Code style: Prettier/ESLint for TS, ktlint for Kotlin, enforced in CI. Small modules, no file over a few hundred lines without a reason.

## 12. Left to the builder

- Dependency injection and state management choices on Android; exact navigation library usage.
- Ring buffer sizing; snapshot serialization details and how scrollback length is capped.
- Reconnect timings; notification grouping details.
- JitPack vs vendored Termux modules.
- Exact keystrokes for answering each agent's prompts (verify against real sessions).
- FFI vs helper process for keep-awake.
- Logging library and log format.
- Detecting the "Thinking" level for the strip (it may not be in the status-line payload; derive from settings or omit).
- Phasing of the implementation plan. A sensible order: daemon + CLI + protocol with tests → app pairing, sessions list, terminal, notifications → chat, questions, status strip → themes, settings, keep-awake, polish, README, CI, release.

## 13. Decisions log

| Decision | Chosen | Alternatives considered |
|---|---|---|
| Phone app | Native Android (Kotlin, Compose) | Web UI in Capacitor; PWA |
| Laptop service | Node + TypeScript daemon, node-pty | tmux in WSL; attach to existing terminals (impossible on Windows) |
| How sessions start | `afk <agent>` launcher; optional user-installed shim | wrapping the agents' own remote features |
| Views | Terminal and Chat tabs, both in v1 | chat-only; terminal-only |
| Network | Tailscale only | Cloudflare tunnel; port forwarding |
| Notifications | App's own foreground service over the tailnet; Telegram hook untouched | FCM; ntfy; keep Telegram |
| Themes | Graphite, Ember, Aurora, Phosphor; light + dark each; Material You dynamic as a bonus | three themes |
| Status strip | Above the composer, both tabs, chips, sideways scroll, no scrollbar | header pill; under the composer |
| Questions | Rendered as buttons in chat and as notification actions | text only |
| Late-joining clients | Headless terminal in the daemon, serialized snapshot (author's call) | raw ring-buffer replay + forced resize repaint |
| Agents typed by hand inside a session | Tracked, via session-scoped PowerShell functions (author's call) | only launcher-started agents tracked |
| Codex approval detection | Best effort in v1, documented limitation (author's call) | PTY heuristic layer in v1 |
| Keep-awake | In v1 | later |
| Inline reply | In v1 | later |
| Playbooks, clipboard bridge | Declined | — |
| Changes / git-diff tab | Future | in v1 |
| Voice, replay, multi-laptop | Future | — |
| Name / repo / package | AFK · `AmaanKhan63/afk` · npm `afkdev`, binary `afk` | tether-dev, overwatch-dev |
| License | MIT (author's call) | Apache-2.0 |
