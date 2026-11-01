# AFK

AFK lets you stay in control of your coding agents while away from your desk. A Node and
TypeScript daemon and CLI (`afkdev`, binary `afk`) runs on your Windows laptop and owns your
Claude Code and Codex terminal sessions, and a native Android app connects to it over Tailscale so
you can watch, answer and steer those sessions from your phone.

**Status: the service (daemon and CLI) is built; the Android app is not yet.** Some behaviours
still need a check by a person on a real terminal or phone; they are listed under
[Pending user verification](docs/notes/attach-verification.md#pending-user-verification).

## How it works

The daemon owns every terminal. Your laptop window and your phone are both clients of it, which is
how a session survives closing the window and how the phone shows exactly what the laptop shows.

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

A session is a real PowerShell (`pwsh` if present, else Windows PowerShell 5.1) in a folder. For
`afk claude`, the daemon types the agent's launch line into that shell, so when the agent exits
you land back in the shell with the session still alive. Each session's agent is started with its
own hooks and status line (Claude Code) or notify program (Codex) pointing back at the daemon over
loopback; your own `~/.claude/settings.json` and `~/.codex/config.toml` are never changed. If
your `config.toml` sets a `notify` program, AFK still runs it after each Codex turn, with the
same argument Codex would have given it. The
daemon listens only on your Tailscale address and `127.0.0.1`. More in
[docs/architecture.md](docs/architecture.md).

## Install

1. Install [Tailscale](https://tailscale.com/download) on the laptop and on the phone, and sign in
   to the same tailnet.
2. Install Node.js 22 or newer (22.23 or later, or 24.22 or later; avoid 24.15.0, which has a
   known crash), then the CLI:

   ```
   npm i -g afkdev
   ```

3. Run the daemon in the background from logon (a Windows scheduled task for your account):

   ```
   afk service install
   ```

4. Pair the phone: `afk pair` prints a QR code. Scan it in the AFK app.
5. Install the app: download the APK from
   [GitHub Releases](https://github.com/AmaanKhan63/afk/releases) (the Android app is not released
   yet).

## Usage

Start agents from a terminal in the folder you want to work in:

```
afk claude --dangerously-skip-permissions
afk codex
afk shell
```

`afk claude`, `afk codex` and `afk shell` create a session in the current folder and attach this
window to it. `afk claude` and `afk codex` pass every argument after their own options to the
agent untouched; `--name` and `--port` count only before the first agent argument.

| Command                                               | What it does                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `afk claude [--name n] [--port n] [claude args…]`     | Start Claude Code in a new session in this folder and attach to it. The session is named after the folder unless `--name` is given.                                                                  |
| `afk codex [--name n] [--port n] [codex args…]`       | The same for Codex.                                                                                                                                                                                  |
| `afk shell [--name n] [--port n]`                     | A plain shell session; takes no arguments. Agents typed into it (`claude`, `codex`) are tracked too.                                                                                                 |
| `afk attach <id\|name> [--port n]`                    | Attach this window to a running session. Detach with `Ctrl+]` then `d`; the session keeps running. Closing the window also detaches. A name matches running sessions only; an id matches any.        |
| `afk ls [--port n]`                                   | List the sessions the daemon owns.                                                                                                                                                                   |
| `afk kill <sessionId> [--port n]`                     | End a session.                                                                                                                                                                                       |
| `afk pair [--name n] [--port n]`                      | Add a phone and print a QR code (and the same payload as one JSON line) for the app to scan. The token is shown once. Needs a Tailscale address on the daemon.                                       |
| `afk devices [--port n]`                              | List the paired phones.                                                                                                                                                                              |
| `afk unpair <deviceId> [--port n]`                    | Revoke a phone's token.                                                                                                                                                                              |
| `afk service install\|uninstall\|start\|stop\|status` | Manage the scheduled task that runs the daemon from logon. `install` also starts it. `--port` (all but `status`) is the port checked for a running daemon. `stop` and `uninstall` end every session. |
| `afk daemon [--verbose] [--port n]`                   | Run the daemon in the foreground (what the scheduled task runs). Stopping it ends every session. `--port` is a development override and is not saved.                                                |

The service commands, one by one:

```
afk service install     # create the scheduled task and start the daemon
afk service status      # is the daemon the task runs up?
afk service stop        # stop it; ends every session
afk service start       # start it again
afk service uninstall   # stop it and remove the task; ends every session
```

Session names are unique among live sessions: a second session in the same folder is `name-2`,
then `name-3`. Ended sessions keep their name and stay listed for 24 hours, then are removed.

A command that cannot reach a daemon prints a hint and exits 2, as it does before the daemon has
ever run (no configuration yet); other failures exit 1. Only the daemon creates the
configuration and the local token: client commands read them and change nothing. After
attaching, the exit code is 0 on detach, 1 if the connection to the daemon was lost, and the
session's own exit code if it ended while you were attached.

Configuration, the hashed pairing tokens and logs live in `%LOCALAPPDATA%\afk\` (`config.json`,
`logs\`, where the daemon deletes log files last written more than 14 days ago when it starts).
The default port is 2350. With `bind` set to `"tailscale"` (the default) and no Tailscale
address yet, the daemon waits up to 30 seconds for one, then listens on loopback only and starts
listening on the Tailscale address when it appears.

The commands `afk exec`, `afk hook` and `afk statusline` are hidden: session shells and the agents
call them, you do not.

### Optional: make plain `claude` start an AFK session

AFK never installs this for you. To have `claude` in your own PowerShell behave like
`afk claude`, add a function to your PowerShell profile (`notepad $PROFILE`):

```powershell
function claude { afk claude @args }
```

Do not put a `claude.cmd` earlier on `PATH` instead: sessions look up the real `claude` on `PATH`
and would find the shim. Inside AFK sessions this function is replaced by the session's own, so
nothing loops.

## Limitations

- The daemon is Windows-only for now: it depends on ConPTY, a Windows keep-awake request and a
  scheduled task. The CLI and the tests also run on Linux in CI, but the product targets Windows 11.
- Stopping or restarting the daemon ends every session and clears the list. While the daemon keeps
  running, ended sessions stay listed for 24 hours (the retention setting) so they can be resumed
  from the phone or the CLI.
- The Codex chat view is thinner than Claude's.
- `afk service` reads `schtasks` output and assumes an English-language Windows.
- A free-text answer to a multi-select question is refused; use the terminal view for that.
- Codex approval prompts are not detected: a Codex session waiting for an approval still shows as
  working, and the phone gets no card or notification for it. Answer it in the terminal view.
- AFK runs your own Codex `notify` program without a shell, so it must name a program, for
  example `notify = ['powershell', '-File', 'C:\scripts\notify.ps1']`, not a `.cmd` or `.bat`
  script, which Windows cannot start that way.
- Some prompt keystrokes are not yet verified from the phone: the Codex approval keys and a few
  Claude keys. See [docs/notes/prompt-keystrokes.md](docs/notes/prompt-keystrokes.md).
- Reattaching at a different window size can redraw imperfectly until the session next paints.
- `npm run dev` in `service/` needs `npm run build` first, because sessions call `dist/cli.js`.

## Battery

_Placeholder: battery guidance for the Android app (foreground service, exclusion from battery
optimisation) will be added with the app._

## Documentation

- [Design spec](docs/superpowers/specs/2026-10-30-afk-design.md)
- [Architecture notes](docs/architecture.md)
- [Wire protocol v1](protocol/protocol.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Service implementation plan](docs/superpowers/plans/2026-10-30-afk-service-plan.md)
- [Android implementation plan](docs/superpowers/plans/2026-10-30-afk-android-plan.md)

## License

[MIT](LICENSE)
