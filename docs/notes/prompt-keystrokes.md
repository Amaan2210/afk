# Agent prompt keystrokes: verification notes

Checked on 2026-10-31 against the real agents through the real ConPTY (`nodePtyFactory`, 120x40,
`TERM=xterm-256color`), for Task 14 of the service plan (`keystrokesForAnswer`, `chunksForAnswer`).

|             | Version                                                  |
| ----------- | -------------------------------------------------------- |
| Windows     | 11 (10.0.26200)                                          |
| Claude Code | 2.1.316 (`C:\Users\amank\.local\bin\claude.exe`)         |
| Codex CLI   | 0.166.0 (`C:\Users\amank\AppData\Roaming\npm\codex.cmd`) |

## Method

A throwaway driver (outside the repo) spawned `claude` in a scratch folder with `CLAUDECODE` and the
other `CLAUDE_CODE_*` variables removed (Claude refuses to start nested), waited for a prompt to
render, wrote candidate keys to the PTY and read the rendered result. The user's global setting is
`defaultMode: auto`, so permission probes passed `--permission-mode default`.

## Claude Code 2.1.316

| Prompt                                                                                                              | Keys                                   | Observed                                                                                                                                                                                                                            | Status               |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| AskUserQuestion, single-select (options render as `1. Cats`, `2. Dogs`, `3. Type something.`, `4. Chat about this`) | `2`                                    | Answered "Dogs" immediately. The digit alone selects and submits. A following `\r` is NOT needed and would land on the composer.                                                                                                    | verified             |
| same                                                                                                                | `Use ferrets\r` (text straight away)   | Answered "Cats": the text is ignored and Enter confirms option 1. Free text cannot be typed directly.                                                                                                                               | verified             |
| same, free text                                                                                                     | `3`, pause, `Use ferrets`, pause, `\r` | Answered "Use ferrets". The digit one past the last option focuses "Type something".                                                                                                                                                | verified             |
| same                                                                                                                | `3Use ferrets\r` in ONE write          | Answered "Cats": the text is dropped when the digit and text arrive together. The digit must be its own write, with a re-render before the text.                                                                                    | verified             |
| AskUserQuestion, multi-select (`1. [ ] Cats`, `2. [ ] Dogs`, `3. [ ] Birds`, `4. [ ] Type something`, `Submit`)     | `13`                                   | No change on screen: digits do NOT toggle here.                                                                                                                                                                                     | verified             |
| same                                                                                                                | Space                                  | Toggles the focused row (`[✔]`).                                                                                                                                                                                                    | verified             |
| same                                                                                                                | Down Down Space (one write)            | Moved two rows and toggled Birds. Cursor keys and Space coalesce fine.                                                                                                                                                              | verified             |
| same                                                                                                                | Down Down, then Enter on `Submit`      | Opens a review screen: "Review your answers ... Ready to submit your answers? `1 Submit answers` / `2. Cancel`".                                                                                                                    | verified             |
| same, review screen                                                                                                 | Enter (default `1 Submit answers`)     | not run                                                                                                                                                                                                                             | UNVERIFIED           |
| Bash permission (`rmdir afk_probe_dir`), `--permission-mode default`                                                | `1`                                    | Ran at once, no Enter needed.                                                                                                                                                                                                       | verified             |
| same                                                                                                                | `2`                                    | Not pressed. The label is "Yes, and always allow access to ... from this project".                                                                                                                                                  | UNVERIFIED (assumed) |
| same                                                                                                                | `3` / `4`                              | Not pressed. With this user's config the prompt had four rows: `1 Yes`, `2 Yes, and always allow ...`, `3 Yes, and switch to auto mode`, `4 No`. "No" is `3` only when the auto-mode row is absent, and `3` here would switch mode. | verified (layout)    |
| same                                                                                                                | Esc                                    | The prompt footer says "Esc to cancel". Not pressed.                                                                                                                                                                                | UNVERIFIED (assumed) |

Decisions that follow from this:

- Single-select is the digit with no Enter.
- Free text is two chunks: the digit of the row after the last option, then `text + "\r"`.
  The caller must wait for a re-render between chunks.
- Multi-select is Down/Space navigation, Enter on the Submit row, then (second chunk) Enter on the
  review screen (that last Enter is unverified).
- Permission: `1` allow, `2` allow always, and deny is Esc rather than `3`, because the row number
  of "No" depends on whether the switch-to-auto-mode row is shown, and pressing `3` there would
  silently change the permission mode.
- Digits address 1-9 only, so a single-select pick or the free-text row beyond the ninth option is
  rejected with `bad_request:`.

## Codex CLI 0.166.0

UNVERIFIED. Launching `codex -a on-request -s read-only "<prompt>"` in the PTY showed only the
login/welcome animation (no authenticated session on this machine), so no approval prompt appeared.
(`-a untrusted` is not accepted by this version; it takes `on-request` or `never`.) The table keeps:

- permission: `y` allow, `a` allow always, `n` deny (the TUI's documented approval keys);
- questions: same scheme as Claude.

Re-run the probe once Codex is signed in. The probe also started Codex's managed app-server
daemon (`codex.exe app-server --managed-daemon`), which outlives the TUI and had to be stopped by
hand.
