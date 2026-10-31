# Per-session injection: verification notes

Checked on 2026-10-31 against the real agents on the development laptop, for Task 5 of the
service plan (`renderClaudeSettings`, `buildClaudeLaunch`, `buildCodexLaunch`).

| | Version |
|---|---|
| Windows | 11 (10.0.26200), Windows PowerShell 5.1 only (no `pwsh`) |
| Node | 24.15.0 at `C:\Program Files\nodejs\node.exe` |
| Claude Code | 2.1.316 (native, `C:\Users\amank\.local\bin\claude.exe`) |
| Codex CLI | 0.166.0 (npm shim, `C:\Users\amank\AppData\Roaming\npm\codex.cmd`) |

## Method

The settings file and the Codex arguments were produced by the real `buildClaudeLaunch` and
`buildCodexLaunch`. Instead of `afk/dist/cli.js`, `cliEntry` pointed at a probe script that
appends its argv, the `AFK_*` environment and the keys of its stdin JSON to a log file. Both the
node path (`C:\Program Files\...`) and the probe path (`...\scratchpad\afk probe\relay.cjs`)
contain spaces, so the runs also exercise the production quoting:

```
"C:\Program Files\nodejs\node.exe" "<scratch>\afk probe\relay.cjs" hook Stop
```

The checks ran from inside a Claude Code session. A nested `claude` ran fine once these variables
were removed from the child environment: `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`,
`CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SESSION_ATTENDED`,
`CLAUDE_CODE_EXECPATH`.

## Claude Code: hooks from `--settings` run

Command (Git Bash, in the probe directory):

```bash
AFK_SESSION_ID=s_probe AFK_PORT=2350 timeout 120 env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT ... \
  claude --settings "<scratch>\afk probe\session\claude-settings.json" --print "say hi" < /dev/null
```

Result: exit 0 after 17 s, reply "Hi! I'm here and ready to help." The probe log shows four
of the nine hooks firing with the exact generated command. `AFK_SESSION_ID`/`AFK_PORT`
reach the hook process, and every payload is JSON on stdin:

| Event | Payload keys |
|---|---|
| `SessionStart` | session_id, transcript_path, cwd, hook_event_name, source |
| `UserPromptSubmit` | session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, prompt |
| `Stop` | session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name, stop_hook_active, last_assistant_message, background_tasks, session_crons |
| `SessionEnd` | session_id, transcript_path, cwd, prompt_id, hook_event_name, reason |

`--print` never invokes the status line. A missing status-line hit in print mode says nothing
about precedence, so the check below was run.

## Claude Code: `statusLine` from `--settings` wins

The same settings file was used in an interactive session, started in a hidden console in the
(already trusted) repository directory and killed after the first status-line call:

```powershell
# with the CLAUDE* variables above removed from $env:
Start-Process -FilePath "C:\Users\amank\.local\bin\claude.exe" `
  -ArgumentList @("--settings", "`"<scratch>\afk probe\session\claude-settings.json`"") `
  -WorkingDirectory "D:\Naya Repos\personal\remote-dev" -WindowStyle Hidden -PassThru
```

Result: `SessionStart` fired, and 1.5 s later the probe was called as `statusline`. Its stdin
carried the status JSON with keys session_id, transcript_path, cwd, scratchpad_dir, effort,
model, workspace, version, output_style, cost, context_window, exceeds_200k_tokens, fast_mode,
thinking, rate_limits. Claude Code runs one status-line command. It ran ours, not the user's
`npx -y ccstatusline@latest`, so the `--settings` value takes precedence. **No fallback needed:
`renderClaudeSettings` keeps `statusLine`.** Task 18's `afk statusline` must therefore chain to
the user's own command itself, as the spec says.

## Claude Code: hooks merge across sources

A second probe used two sources at once:

- a project file `<dir>\.claude\settings.json` with `Stop` and `UserPromptSubmit` hooks
  (`relay.cjs proj <event>`);
- a `--settings` file with only a `Stop` hook (`relay.cjs flag Stop`).

```bash
claude --settings "<dir>\flag.json" --print "say hi"
```

Result: `proj UserPromptSubmit`, `proj Stop` and `flag Stop` all fired. The two `Stop` hooks
fired in the same millisecond. **Hooks from `--settings` are added to the other sources'
hooks for the same event, not substituted for them.**

### The user's own Telegram hooks: pending user verification

The user's `~/.claude/settings.json` (read, never written) has `Notification`, `Stop`,
`SubagentStart` and `SubagentStop` hooks that run `~/.claude/hooks/notify.ps1`. Their `Stop`
branch rewrites `~/.claude/hooks/active-agents.json` on every call. That file was not touched
by any of the nested runs above. That includes a control run **without** `--settings`
(`claude --print "say hi"`, same environment). So whatever stops the user-level hooks from
leaving a trace in these nested runs is not `--settings`. Watching Telegram was not possible
from here.

To confirm, run this from a normal terminal (not inside Claude Code) and check that the usual
"Task Complete" Telegram message arrives:

```powershell
claude --settings "<any file produced by buildClaudeLaunch>" --print "say hi"
```

Or start any `afk claude` session once Task 19 has landed.

## Codex: `-c notify=[...]` works in 0.166.0

Command (Git Bash, in the probe directory; the argument is exactly what `buildCodexLaunch`
returned):

```bash
AFK_SESSION_ID=s_probe AFK_PORT=2350 timeout 120 codex \
  -c 'notify=["C:\\Program Files\\nodejs\\node.exe","<scratch>\\afk probe\\codex-probe.cjs","hook","codex-notify"]' \
  exec --skip-git-repo-check "say hi" < /dev/null
```

Result: exit 0 after 17 s, reply "Hi!", no complaint about `notify`. The only warning was about
an unrelated `terminal` key in the user's own `config.toml`. The notify program ran once with
argv `["hook", "codex-notify", <json>]` and inherited `AFK_SESSION_ID`. The JSON is the last
argument:

```json
{"type":"agent-turn-complete","thread-id":"01a19111-a350-7b70-8285-d9c5c3e0ea7c",
 "turn-id":"01a19111-b27c-7ea3-9f2b-7ec575967fb1","cwd":"<scratch>\\afk probe",
 "client":"codex_exec","input-messages":["say hi"],"last-assistant-message":"Hi!"}
```

The key name `notify` and the TOML array form with doubled backslashes are correct for 0.166.0,
so `buildCodexLaunch` is unchanged. The `[tui] notifications` form was not needed.

## Open point for Task 18

The resolved Codex binary on this machine is `codex.cmd`. Node refuses to spawn `.cmd` files
without `shell: true`, and with a shell, cmd.exe re-parses the `notify=["..."]` argument
(quotes, backslashes). `afk exec` must either quote for cmd.exe or bypass the shim and run the
package's `codex.js` with node directly. The check above went through the npm sh shim (Git
Bash), not through `codex.cmd`.
