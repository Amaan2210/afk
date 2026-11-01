# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The scope of 0.1.0, the first release: the service (daemon and CLI). The Android app is a
separate, later change.

### Added

- Daemon that owns Claude Code, Codex and shell sessions as PowerShell pseudo-terminals (node-pty
  and ConPTY), with a session state machine (`idle`, `working`, `needs_input`, `finished`,
  `ended`), unique live session names, a 24-hour retention window for ended sessions, and a
  headless terminal per session so a late client gets the current screen.
- Per-session injection of hooks and a status line (Claude Code) and a notify program (Codex)
  that report to the daemon over loopback, without touching the user's own settings.
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

### Known limitations

- Windows-only daemon; the CLI and tests also run on Linux in CI.
- Restarting the daemon ends every session and clears the list; ended sessions are kept in memory for 24 hours only while it runs.
- `afk service` assumes English-language Windows output from `schtasks`.
- Free-text answers to multi-select questions are refused.
- Some prompt keystrokes (Codex approvals, a few Claude keys) are unverified from the phone.
