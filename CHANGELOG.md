# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The scope of 0.1.0, the first release: the service (daemon and CLI) and the Android app.

### Added

- Daemon that owns Claude Code, Codex and shell sessions as PowerShell pseudo-terminals (node-pty
  and ConPTY), with a session state machine (`idle`, `working`, `needs_input`, `finished`,
  `ended`), unique live session names, a 24-hour retention window for ended sessions, and a
  headless terminal per session so a late client gets the current screen.
- Per-session injection of hooks and a status line (Claude Code) and a notify program (Codex)
  that report to the daemon over loopback, without touching the user's own settings; the user's
  own Codex `notify` program still runs after each turn.
- Chat view data for both agents, read from Claude Code transcripts (sub-agents included) and
  Codex rollouts, with a status strip and answers to questions and permission prompts.
- Authenticated WebSocket API and loopback HTTP relays, specified in `protocol/` with a JSON
  Schema generated from the daemon's zod schemas and checked in CI.
- Binding to the Tailscale address and loopback; the daemon waits up to 30 seconds for Tailscale
  at start and picks its address up later if it appears.
- Keep-awake while a session works, device pairing with a QR code, system stats, and a folder
  picker backend.
- CLI `afk`: `daemon`, `claude`, `codex`, `shell`, `attach` (detach with `Ctrl+]` then `d`), `ls`,
  `kill`, `pair`, `devices`, `unpair`, and `service install|uninstall|start|stop|status`, which
  runs the daemon from logon as a Windows scheduled task.
- README, architecture notes, and a release workflow that publishes the `afkdev` package to npm
  with provenance on a `v*` tag.
- Android app (`android/`): pairs with the daemon by QR code over Tailscale and shows the session
  list with filters and search, a live terminal (vendored Termux emulator with a key bar and pinch
  zoom), a chat view where questions and permission prompts are answered in place, a sub-agent
  thread screen, new sessions with a folder picker and launch flags, settings (laptop, themes and
  modes, status strip, notifications, terminal), an offline banner and an About screen with the
  bundled licences.
- A foreground service on the phone keeps the connection alive, starts on boot when paired, and
  posts notifications for questions, finished turns and sub-agents with up to three actions.
- CI for the app on JDK 21, a phone QA checklist, and an `android` release job that attaches
  `afk-<tag>.apk` to the GitHub release, signed with a keystore from secrets when present.

### Known limitations

- Windows-only daemon; the CLI and tests also run on Linux in CI.
- Restarting the daemon ends every session and clears the list; ended sessions are kept in memory for 24 hours only while it runs.
- `afk service` assumes English-language Windows output from `schtasks`.
- Free-text answers to multi-select questions are refused.
- Codex approval prompts are not detected; the session shows as working and the phone gets no
  card for them. Answer them in the terminal view.
- The user's own Codex `notify` must name a program, not a `.cmd` or `.bat` script.
- A few Claude prompt keystrokes are unverified from the phone.
- Resuming a session whose command carried a prompt passes that prompt to the agent again.
- The detach chord is fixed to `Ctrl+]` then `d`.
- Reattaching at a different window size can redraw imperfectly until the session next paints.
- Node.js 24.15.0 crashes intermittently in the test suite (a libuv bug); develop on 22.23.x or
  24.22 and newer.
- Android app limitations are listed in `docs/android-follow-ups.md` and in the QA checklist's
  Known limitations.
