# `afk attach`, launchers and detach: verification notes

Checked on 2026-11-01 for Task 19 of the service plan (`afk claude|codex|shell`, `afk attach`,
the `Ctrl+]` `d` detach chord).

|                 | Version                                      |
| --------------- | -------------------------------------------- |
| Windows         | 11 (10.0.26200.9711), Windows PowerShell 5.1 |
| Node            | 24.15.0                                      |
| node-pty        | 1.1.0 (ConPTY)                               |
| @xterm/headless | 6.0.0 (the driver's screen mirror)           |
| Claude Code     | 2.1.316                                      |
| Codex CLI       | 0.166.0 (not exercised here)                 |
| afk             | 0.1.0, `service/dist` built from this change |

## Method

Windows Terminal cannot be watched from an agent, so a throwaway driver (outside the repo) ran
the real CLI in a pseudoconsole:

- It spawned `node dist/cli.js <command> --port 23998` with node-pty at 100x30. It wrote
  keystrokes to the pty.
- It fed everything the pty printed into a headless xterm of the same size. The checks read
  that screen, not the raw bytes.
- It read each process's exit code from node-pty's `onExit`.

The daemon was the real one. The driver ran `node dist/cli.js daemon --port 23998` inside its
own pseudoconsole:

- It used the real `%LOCALAPPDATA%\afk` config dir.
- It removed `CLAUDECODE` and the `CLAUDE_CODE_*` and `CLAUDE_PID` variables the ruling lists
  from the environment.
- `--verbose` was added for the Claude run, so hook relays reach the log.
- It was stopped with Ctrl+C.

No device was paired. The test sessions' folders and `recent-folders.json` were removed
afterwards.

One-shot commands (`afk ls`, `afk kill`) ran without a pty. Commands that attach always ran
in one.

## Results

| #   | Check                                                    | Observed                                                                                                                                                                                                                                                                     | Status |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `afk shell --name …` shows the profile banner and prompt | After 1.3 s: `afk session s_pw2qwwyc6xtl · detach: Ctrl+] d`, then `PS C:\…\proj>`.                                                                                                                                                                                          | pass   |
| 2   | `dir` + Enter shows output                               | The `Directory:` header, the `Mode  LastWriteTime  Length Name` table and `readme.txt` rendered, then a new prompt.                                                                                                                                                          | pass   |
| 3   | The session has the window's size                        | `$Host.UI.RawUI.WindowSize` printed `100 30` in a 100x30 window.                                                                                                                                                                                                             | pass   |
| 4   | Multi-byte output                                        | `Write-Output "utf8: é ✓ 日本"` rendered `utf8: é ✓ 日本`.                                                                                                                                                                                                                   | pass   |
| 5   | `Ctrl+]` then `d` detaches                               | Sent as two writes 300 ms apart. Printed `[afk] detached, session afk-verify-3 keeps running · afk attach afk-verify-3`. Exit code 0. The `d` did not reach the shell.                                                                                                       | pass   |
| 6   | `afk ls` after detaching                                 | `afk-verify-3  shell  idle`.                                                                                                                                                                                                                                                 | pass   |
| 7   | `afk attach <name>` restores the screen                  | Same size (100x30): the snapshot showed the banner, the earlier `dir` output, the size output and the UTF-8 line, identical to before detaching.                                                                                                                             | pass   |
| 8   | Killing the attach process (the window closing)          | The process exited with `0xC000013A`. `afk ls` still listed the session `idle`.                                                                                                                                                                                              | pass   |
| 9   | Attach after the kill                                    | Attached in a 90x25 window. Typing `echo again-$((6*7))` printed `again-42`, so keys and output flow both ways. See observation A on the redrawn screen.                                                                                                                     | pass   |
| 10  | The session ends while attached                          | `exit 7` in the session printed `[afk] session ended (exit 7)`. The attach exit code was 7. `afk ls` showed the session `ended`.                                                                                                                                             | pass   |
| 11  | `afk claude --port 23998` (repo folder, no args)         | The session's `claude` function ran `afk exec` → Claude Code. The TUI rendered within 9.3 s: the logo with `Claude Code v2.1.316`, model and folder, the input box `❯ Try "edit <filepath> to..."`, and the mode footer. Nothing was typed into Claude.                      | pass   |
| 12  | The daemon saw the agent start                           | `afk ls`: `remote-dev  claude  idle  feat/service`. The daemon log at `%LOCALAPPDATA%\afk\logs` has relays for this session: `POST /sessions/s_2heyyefwnrch/agent-start`, `POST /statusline`, `POST /hooks/claude/SessionStart`. This also covers the Task 18 carry-forward. | pass   |
| 13  | Reattach to Claude                                       | `afk attach remote-dev` redrew the TUI from the snapshot, including the status line rendered through the `afk statusline` relay.                                                                                                                                             | pass   |
| 14  | Detach from Claude                                       | `[afk] detached, session remote-dev keeps running · afk attach remote-dev`, on a clean line, exit 0. The second run, after fix 2 below.                                                                                                                                      | pass   |
| 15  | `afk kill` the Claude session                            | `Killed s_2heyyefwnrch.`, and the state became `ended`.                                                                                                                                                                                                                      | pass   |
| 16  | `afk attach <name>` to an ended session | ``afk: There is no running session "remote-dev"; one by that name has ended. `afk ls` lists them.``, exit 1. By id, the session is found: `The session remote-dev has ended (exit 1); there is nothing to attach to.`                                                                                                                                                                                    | pass   |
| 17  | `afk attach` with an unknown name                        | ``afk: There is no session "no-such-session". `afk ls` lists them.``, exit 1.                                                                                                                                                                                                | pass   |
| 18  | `afk attach` with a name two live sessions share         | ``"twin" names 2 sessions; use `afk attach <id>`:``, then one line per session with its id, name and state (`idle`), exit 1.                                                                                                                                                 | pass   |
| 19  | Attach or launch without a TTY                           | `afk: Attaching needs an interactive terminal, and stdin is not one.`, exit 1. Nothing was created.                                                                                                                                                                          | pass   |
| 20  | `afk shell extra`                                        | Commander's `too many arguments for 'shell'`, exit 1.                                                                                                                                                                                                                        | pass   |
| 21  | The daemon is killed (`taskkill /F`) while attached      | Printed `[afk] lost connection to the daemon`, exit 1. No session shell was left behind.                                                                                                                                                                                     | pass   |
| 22  | The daemon is stopped                                    | Ctrl+C stopped the daemon, exit 0. Then `afk ls`, `afk attach twin`, `afk shell` and `afk claude --model x` all printed the not-running hint and exited 2.                                                                                                                   | pass   |

## Fixed during verification

1. **The detach chord never arrived.** A session's pseudoconsole opens its output with
   `ESC[?9001h`, which asks the hosting terminal for win32-input-mode. Attach passed that byte
   sequence on to its own window. The window's console then encoded every key as a win32-input
   sequence: `Ctrl+]` arrived as `ESC[221;27;29;1;8;1_`, not `0x1d`. Typing still worked,
   because the session's pseudoconsole understands that encoding, but the chord was never seen,
   and the `d` reached the shell.
   - A probe confirmed it: Node 24's raw stdin under ConPTY reads `1d` for `Ctrl+]`, and the
     escape sequence after the app writes `ESC[?9001h`.
   - `src/cli/conpty-filter.ts` now drops that request from the session's output, including
     one split across chunks.
   - This affects a real Windows Terminal the same way: Windows Terminal also hosts the CLI
     through ConPTY.
2. **The detach message left the session's drawing behind it.** In Claude's TUI the cursor sits
   in the input box, so the message landed on the rule below and the rest of the rule followed
   it. The message now starts with `\r\n` + `ESC[J`, which clears below the cursor.

## Observations (not changed here)

- **A. Reattaching at another size redraws imperfectly.** The window was 90x25 against the
  session's earlier 100x30. On subscribe the daemon resizes the session and serializes its
  headless terminal, and that snapshot already differs from a clean redraw:
  - lines ConPTY had padded to the old width wrap into an extra blank line;
  - the wrapped part of the last prompt lost a segment.

  ConPTY sent no repaint within 2.5 s, so the window shows that snapshot until new output arrives.
  The cause is in the daemon's snapshot after a resize, not in attach. It affects the Android
  client too. Reattaching at the same size is exact.

- **B. Ended sessions keep their names for the retention period (24 h).** Following ruling 1
  literally, an ended session and a live one with the same name made `afk attach <name>`
  ambiguous, and the detach hint failed for a shared name or one with a space. Resolved after
  review; see below.
- **C. A killed Claude session reports exit 1.** This is the code the daemon recorded.

## Changed after review

- The daemon keeps names unique among live sessions. A create or rename onto a name a live
  session holds gets the first free `-2`, `-3`, …. Ended sessions keep their names but block
  nothing.
- `afk attach <name>` matches running sessions only. An id still finds an ended session, which
  gets the "has ended" message, exit 1. Row 18's error is now reached only in a race.
- The detach hint quotes a name with whitespace: `afk attach "My Repos"`.
- A session that ends with no exit code known prints `(exit 0)`, the code the command exits with.
- Leaving resets the cursor shape with `ESC[0 q`, the terminal's default.
- The terminal check runs before the daemon is contacted. Without a TTY and without a daemon, the
  commands print the TTY message and exit 1, not the not-running hint and 2. Checked with the
  built CLI and stdin redirected from a file.

## Pending user verification

Each of these needs a person, a real terminal or the phone. Paths assume the repo at
`D:\My Repos\personal\remote-dev`. Build first: `cd service; npm run build`.

1. **A Windows Terminal pass of the checks above.**
   1. In one tab, run `node "D:\My Repos\personal\remote-dev\service\dist\cli.js" daemon --port 23998`.
   2. In a second tab, in a project folder, run `afk shell --port 23998`. Here and below, `afk`
      means `node "…\service\dist\cli.js"`. The banner and prompt should appear.
   3. Run `dir`, then press `Ctrl+]` then `d`. The detach line should print and the tab's own
      prompt should return.
   4. Check the tab is back to normal: arrow keys and history work, a paste is not wrapped in
      `^[[200~`, and nothing like `^[[I` or `^[[O` appears when you switch windows.
   5. `afk ls --port 23998` should show `idle`.
   6. `afk attach <name> --port 23998` should restore the screen.
   7. Drag the window to resize it while attached. The shell should reflow to the new size,
      with no flicker loop.
   8. Close the tab with its X. In a new tab, `afk ls` should still list the session, and
      `afk attach` should work.
   9. Attach the same session from two tabs of different sizes. Typing in one should give the
      session that tab's size, and the tabs must not resize each other back and forth.
   10. Repeat with `afk claude --port 23998` in a folder Claude trusts, and send one prompt.
       After `Ctrl+]` `d`, the tab must be back to normal: cursor visible, mouse wheel
       scrolling, no stray escape codes on focus change or paste. The cursor should also have
       the tab's usual shape. Attach writes `ESC[0 q` on the way out, and Windows Terminal maps
       that to the profile's cursor shape. Check it after a TUI that sets a bar cursor, as
       Claude's input box may.
   11. Repeat with `afk codex --port 23998`.
2. **Prompt keys from the phone.** The rows marked UNVERIFIED in `docs/notes/prompt-keystrokes.md`.
   Pair the phone with `afk pair`.
   1. Start `afk claude --permission-mode default` and ask for a Bash command that needs
      permission, such as `mkdir afk_probe`.
   2. Answer **Deny** from the phone. Expect Esc to be sent and Claude to report the denial.
   3. Trigger the prompt again and answer **Allow always**. Expect `2`, and the rule to be
      added for the project.
   4. Ask Claude to use AskUserQuestion with `multiSelect: true`. From the phone, pick two
      options and submit. Expect toggles, then `Submit`, then the review screen's
      `1 Submit answers` (Enter), and the answer shown in the transcript.
   5. Start `afk codex` with an approval policy that asks (for example
      `-c approval_policy=on-request`). Trigger a command approval, and answer allow, allow
      always and deny from the phone, one prompt each. Check each key against the Codex
      prompt and record them in `prompt-keystrokes.md`.
3. **Resuming must not replay a stale prompt.**
   1. In an AFK session, run `claude --resume` and pick a past conversation that ended on a
      question or a permission prompt.
   2. Confirm that `afk ls` stays `idle` and not `needs_input`, and that the phone gets no
      notification from the replayed history.
   3. Only a new prompt in the resumed conversation should notify.
4. **Keep-awake request.** Start `afk claude`, and give it a task that runs for a few minutes.
   1. While it works, run `powercfg /requests` in an **elevated** PowerShell. Under `SYSTEM:`
      there should be a `[PROCESS]` entry for the daemon's `node.exe`.
   2. Once the agent has finished and the keep-awake grace period (10 min by default) has
      passed, run it again. The entry should be gone.
5. **Interrupting a turn returns the session to idle.** The interrupt markers AFK reads were
   reconstructed from the agents' formats, not captured (`service/test/fixtures/claude/interrupted.jsonl`,
   `service/test/fixtures/codex/interrupted.jsonl`).
   1. In `afk claude`, give Claude a task that runs a while, and press `Esc` mid-turn. `afk ls`
      should show `idle` within a second, and the phone's card should leave Working. The
      transcript should hold a user line starting `[Request interrupted by user`.
   2. In `afk codex`, do the same and press `Ctrl+C` (or `Esc`). The rollout under
      `~/.codex/sessions` should hold an `event_msg` of type `turn_aborted`, and the session
      should show `idle`.
   3. After either, wait out the keep-awake grace period (10 min by default) and check
      `powercfg /requests` (elevated): the daemon's entry should be gone.
