# Phone QA feedback

Findings from the phone pass of `docs/qa-checklist-android.md`. `[x]` = fixed in code (the
phone re-test comes after all fixes). The fix log is at the end.

## Whole-repo task

- [x] **Scan the whole repo and its full git history for anything that should not have been
      pushed.** The repo is now public, so everyone can read every commit. Look for: keys,
      keystores, passwords, tokens, personal paths, emails, phone or laptop names, device ids,
      pairing tokens, `.env` files, screenshots showing private data. If something is found,
      list it and decide with the owner whether to rotate it or rewrite history.

## Section 1: Before you start

- [x] **1. Daemon not running.** (running after `afk service start`) `afk service status` said not running. Gave the start command
      (`afk service start`). Open question: why was it not running when `afk service install`
      was done earlier? Check that the scheduled task survives a reboot and logoff.
- [x] **2. Instrumented tests.** Skipped. The owner says they passed in an earlier run.
- [x] **4. Sessions started without AFK.** Question: can the app show sessions that were
      started outside `afk`? Answer: no, the daemon only knows sessions it launched. Decide
      whether to say so in the README or to build it (future list).

## Feedback session 01 (Section 1)

- [x] **S1-1. First-time setup is not explained in the app.** Nothing says to start Tailscale,
      or to run `afk service start`. When the app is not connected, the pairing screen should
      show the steps: install and open Tailscale on both devices, run `afk service start`,
      run `afk pair`, then scan.
- [x] **S1-2. Building the release APK takes too many steps.** Add one script that sets the
      signing variables (asking for the password), builds, and installs on the phone.
- [x] **S1-3. Release APK would not install.** Error "App not installed as package conflicts
      with an existing package" after uninstalling AFK. The file `app-release.apk` was dated
      today, so the build did run. Cause confirmed: a leftover install shown in Settings → Apps as "App not installed for this user". Uninstalling it there fixed it. The checklist step does not say
      where the APK is or how to send it. Make the install step in the checklist plain, and
      the script from S1-2 should do the install.
- [x] **S1-4. Add checks for detach and closing the connection.** The checklist has none.
      Cover `afk attach`, the `Ctrl+]` then `d` detach, and ending a session from the phone
      versus the laptop. Owner wants to review this once.

## Feedback session 02 (Section 2: Pairing)

All eight checks worked. Notes:

- [x] **S2-1. Redesign the "Pair with your computer" screen** for better look and flow. Fold in
      the setup steps from S1-1.
- [x] **S2-2. Name confusion.** The name typed at `afk pair` ("Device name") is the phone's
      name in `afk devices`. The app's "Connected to X" shows the laptop's own hostname
      ("Amaan"), so changing the typed name never changes it. Make the two clear: label the
      prompt "Name for this phone", and decide whether the laptop name can be set too.
- [x] **S2-3. Test connection and Save should be one button.** Show only **Test connection**
      until the test passes, then show **Save**. Show "Connected to X" as a small pop-up at
      the bottom (snackbar), not as text in the form.

## Feedback session 03 (Sections 2 follow-up and 3: Sessions list)

- [x] **S2-2 update. Let the owner set the laptop's display name** (what the phone shows in
      "Connected to X" and the top strip), not only the computer name. Also make the
      `afk pair` terminal output nicer: clear steps, the QR code, host, port and token laid
      out plainly.
- [x] **S3-1. Terminal and chat box both take typing** in a session, which is confusing. Owner
      says leave it for now. Revisit.
- [x] **S3-2. Chat view does not work.** Only the Terminal tab works. Find out which session
      types it was tried on (Claude, Codex, shell). Shell has no chat by design. If Claude or
      Codex show nothing, this is a bug, and possibly the transcript-format risk from the
      future list. Check the daemon log.
- [x] **S3-3. Killing a session from the laptop is awkward.** `afk kill <id>` needs the id
      from `afk ls`. Let `afk kill` work with no id from inside a session window (kill the
      session that window is attached to), and also accept a session name.
- [x] **S3-4. Remove ended sessions from the phone.** Ended sessions can only be killed, not
      cleared. Add a Delete / Clear action for ended sessions (and maybe "Clear all ended").

Section 3: all 9 checks passed.

## Feedback session 04 (Section 3 follow-up and Section 4: Notifications)

Section 4 is blocked until the items below are fixed. Screenshots showed a Claude session on
Fable 5.2 in auto mode.

- [x] **S3-2 update. Hide the Chat tab for shell sessions** (they have no chat).
- [x] **S3-5. Ended shell sessions cannot be resumed, so remove them from the phone
      automatically** when they end or are killed. Ended Claude and Codex sessions stay
      (they can be resumed), and get the Delete action from S3-4.
- [x] **S4-1. "Choose a folder" in New session shows "Not connected"** after a while, although
      the phone is connected. Find the cause (folder browse request failing or timing out).
- [x] **S4-2. Show errors and short messages as a pop-up at the bottom** (snackbar), the way
      "Connected to X" should be (S2-3), everywhere in the app, not as text in the screen.
- [x] **S4-3. Session stays listed after Claude exits at the trust prompt.** Ran `afk claude`,
      got "Do you trust this folder?", pressed Ctrl+C, Claude exited, and the app still
      listed the session. The shell inside is probably still alive, so the session is not
      "ended". Decide: end the session when the launched agent exits before it starts, or
      show it as "agent exited".
- [x] **S4-4. Hide Claude's own status line in the terminal view.** It is cropped and cut off
      on the phone, and the app has its own strip. Also, its icons show as empty boxes
      (missing glyphs) in the terminal font.
- [x] **S4-5. Status strip chips do not all show.** Turned on Model, Thinking, Cost, Context
      used and Session time. Only Model, Cost and Session time appear. Thinking and Context
      used are missing. Check whether the status-line data carries them.
- [x] **S4-6. Composer Send needs two taps.** Typing in the app's reply box and tapping Send
      puts the text into Claude's input bar, but Claude does not submit it until Enter is
      sent again. Send must submit it in one tap. Same check in the Terminal tab's composer.
- [x] **S4-7. Chat view drops parts of the conversation.** Compared Terminal and Chat for the
      same session. Chat showed the user's prompts and Claude's closing sentence, but left
      out the question's answers ("Which color do you like? → Blue", "favorite number? → 7").
      Claude's question appeared as plain text with no options and no card, so a pending
      question could not be answered from Chat. Screens: the colour question and the
      "morning person or night owl" question (2 options plus "Type something").
- [x] **S4-8. Custom notification sound.** Let the owner choose or set a sound for AFK
      notifications.
- [x] **S4-9. Permission notification with nothing to answer in the app.** Session was in auto
      mode. Allowed one permission in Chat. On the next question, a "needs your permission"
      notification arrived, but the app showed no Allow / Deny prompt. The Terminal view never
      asked for permission at all. Find what the hook reports and why Chat has no card.
- [x] **S4-10. Notifications replace each other.** For each new question, the "Needs your
      input" notification (with option buttons) appears, then is replaced within moments by a
      "needs your permission" one, so the options cannot be tapped. Probably the same cause as
      S4-9: the permission hook fires for the question tool itself. One notification per
      session should show the right kind and keep the options.

Section 3 and Section 4 re-test needed after these fixes. Notifications (Section 4) were not
completed.

Section 4 (Notifications): all 11 checks left unchecked on purpose. Re-run the whole section after S3-2 to S4-10 are fixed.

## Feedback session 05 (Section 5: Terminal)

Checks 1 to 14 worked.

- [x] **S5-1. Simplify typing and answering in the Terminal tab.** Choosing an option in the
      terminal means picking it in the terminal, then tapping Send in the bottom box. Two
      places to type is confusing (also S3-1). Aim for one input in the Terminal view: tapping
      an option or typing should send straight away. Needs a design decision before code.
- [x] **S5-2. Turn off swipe between Terminal and Chat by default** (check 12), and add a
      switch in Settings to turn it on.

## Feedback session 06 (Section 6: Chat)

Screenshots for these notes are saved outside the repo (they show personal paths) in
the owner's `afk-qa-screenshots` folder, next to the repo, as 1.png to 5.png: 1 and 2 = terminal vs chat
after two questions (S4-4, S4-7); 3 and 4 = terminal vs chat with a pending question (S4-7);
5 = chat after a sub-agent finished (S6-2). Do not commit them.

Passed: 2, 3, 11, 12, 13. Checks 4 to 9 (questions) were not run here: they were already
answered during Section 4 and failed there (S4-7), so re-run them after the fix.

- [x] **S6-1. Chat is less clear than the Terminal tab.** Make the chat easier to read
      (spacing, hierarchy, what is a message and what is a tool). Needs a design pass.
- [x] **S6-2. Chat shows internal text as the user's messages.** After a sub-agent finished,
      big blocks appeared as if the user sent them: `<system-reminder>`, an
      `<agent-message>` hand-back and a `<task-notification>` with ids and file paths. The
      chat must hide these machine-made messages (or show them as a small
      "sub-agent finished" line). Parse the transcript so only real user prompts show in
      the user bubble.
- [x] **S6-3. Commands cannot be run from the Chat tab.** Slash commands (such as /clear) and
      shell commands typed in the chat box do not work. Clarify what is wanted: send them
      through to Claude as typed text, or hide them. Terminal tab still runs them.

## Feedback session 07 (S6-3 follow-up and Section 7: Navigation)

- [x] **S6-3 update.** `/model` passes through to Claude, but the Chat tab shows no response
      and no model picker. The picker only appeared in the Terminal tab. When a slash command
      opens an interactive menu, Chat should say "open in Terminal" with a button that
      switches tabs.
- [x] **S7-1. About and licenses is too long.** The licence texts are big. Collapse each
      library's licence (tap to expand), keep the app's own licence at the top.
- [x] **S7-2. Resumed session has no laptop window.** Killed a session from the phone (its
      Windows Terminal window closed). Resume from the phone worked, but no window opened on
      the laptop. Cause: the daemon runs the session itself, and a laptop window is only an
      attached view. Decide: tell the user ("running on the laptop, attach with
      `afk attach <name>`"), offer an "open on laptop" action, or both.

Section 7: checks 1 to 10 passed except the notification ones (2, 3, 4, 5, 6, 7, 8), which are
blocked until Section 4 is fixed. Re-run them then.

## Feedback session 08 (S7-2 follow-up and Section 8: New session)

- [x] **S7-2 decision (owner).** Sessions started or resumed from the phone should also open a
      window on the laptop, attached to the session, so phone and laptop behave the same.
      Add a setting to turn it off. Today the daemon starts them with no window.

Section 8: all 5 checks blocked by S4-1 (the folder picker fails with "Not connected"). Re-run
the whole section after S4-1 is fixed.

## Feedback session 09 (Section 9: Settings)

Checks 1, 4 and 6 worked.

- [x] **S9-1. Keep-awake does not come back on the second toggle.** First time: on, the daemon
      showed in `powercfg /requests`, off, it went away. Turning it on again did not show
      the daemon again, even after restarting the terminal. Check whether the daemon
      re-requests the lock, or the phone does not resend the setting.
- [x] **S9-2. Keep-awake switch greys out late.** After turning Wi-Fi off, the switch only
      greyed out after it was tapped. It should grey out as soon as the connection drops.
- [x] **S9-3. Going offline and back created a duplicate session.** A Claude session
      (`api-server`) showed "Ended" after the connection came back. Resume continued it but
      also added a new session `api-server-2`. Find out: why it ended (did the daemon end it,
      or was it already gone), and why Resume left two entries.
- [x] **S9-4. Status strip switches do not work** except Model, Cost and Session time. Same
      problem as S4-5. Check each chip against what the status line sends.
- [x] **S9-5. Old paired phones pile up.** `afk devices` lists 4 phones besides the current
      one, left from earlier pairings. Unpair in the app does not remove the phone on the
      laptop. Make the app's Unpair also revoke its own token on the laptop, and let
      `afk devices` show when each phone was last seen.

## Feedback session 10 (Section 10: Theme & icon)

Checks 1 to 8 worked, except the note below.

- [x] **S9-5 update (owner confirmed).** Unpair in the app must automatically revoke the
      phone on the laptop, with no `afk unpair` needed.
- [x] **S10-1. Search box keeps focus.** After long-pressing in the search box (paste /
      autofill menu), tapping outside does not remove focus or close the keyboard. Tapping
      outside any text field should clear focus.
- [x] **W-1. Write a plain walkthrough of how it all works**, then check the app against it:
      how a phone connects (pair, token, reconnect), how a connection closes, how sessions
      are created (laptop and phone), how they end, how they are kept (retention, resume),
      and what happens to sessions when the phone unpairs, the app closes or the daemon
      stops. Triggered by: after Unpair and pairing again, a session resumed from the phone
      was still running. Check what is intended and what is a bug.

## Section 11: Accessibility

Skipped on purpose: the owner does not use TalkBack. The 7 checks stay unchecked.

## Feedback session 11 (Section 12: Offline / reconnect)

Checks 3, 4 and 6 worked.

- [x] **S12-1. Offline banner appears too late.** It only showed after Wi-Fi came back and the
      app reconnected, not within a minute of going offline. It must show while offline.
      Also change the look: a banner or snackbar that drops in from the top (owner's wording:
      "a popup from top", like a snackbar). Same for the "Connection refused: unauthorized"
      message (check 5, which showed the right text).
- [x] **S12-2. Sessions go blank when offline.** The last known list and sessions should stay
      visible (the checklist says so). Instead they went blank, so nothing could be typed or
      sent, and no "Not connected" message appeared. Keep the last screen, disable Send
      with a clear note, and show "Not connected" if the owner still taps it.

## W-1 walkthrough

The walkthrough is in `docs/how-afk-works.md`. Each line was checked against the code (not on the
phone). Result per line:

Matches the code:

- Token shown once, only hashes stored. Wrong or revoked token is refused and the phone stops retrying.
- Reconnect with growing pauses and a banner. Connection kept by the background service, so closing the app keeps it.
- Unpair forgets the laptop on the phone. Sessions keep running through a drop, a closed app, or Unpair.
- Closing a laptop window, or Ctrl+] then d, leaves the session running.
- Ended sessions stay 24 h. Ended shell sessions cannot be resumed.
- Resume keeps the old name if no running session has it.
- Stopping the daemon ends every session and clears the list.
- `afk devices` shows when each phone last connected.

Differs from what the owner expects (already logged above):

- Unpair does not revoke the phone on the laptop. Owner confirmed it should. **S9-5.**
- A session started or resumed from the phone opens no laptop window. **S7-2.**
- When Claude quits, the session stays running with its shell. **S4-3** (decide: end it, or show "agent exited").
- Ended shell sessions stay until pruned. **S3-5.**
- Offline, the session view goes blank. **S12-2.**

Open, not explained yet:

- **S9-3 duplicate.** Resume only gives `-2` if another running session had the name. Check the daemon log for the session ids around the time `api-server-2` appeared.

Owner's question on re-pairing (a session resumed from the phone was still running after Unpair
and pair again): intended. Sessions belong to the daemon, so Unpair and pairing do not touch them.
The bug is that the old phone can still connect until `afk unpair` (S9-5).

Section 13 (detach, closing a session) is now in the checklist as "Detach and closing", between
Offline and Release. Sent for testing.

## Feedback session 12 (W-1 review: connection and session lifecycle)

- [x] **W1-1. Tie the service to pairing, not to logon.**
      - `afk pair` starts the AFK service first. Then it asks the user to start Tailscale and
        waits until they say yes. Only then does it pair (QR code, token).
      - `afk unpair` removes the phone from `afk devices`, ends every session (closing their
        windows), and stops the service.
      - Owner's answers:
        - **No start at logon, ever.** The service runs only after `afk pair`. Reason: once
          open source, anything that starts at logon would worry new users into deleting it.
          Drop the logon task. After a laptop restart, the phone cannot connect until
          `afk pair` runs again.
        - **One phone, one laptop** for now.
        - **The app's Unpair does the same as `afk unpair`** (replaces S9-5).
        - **Unpair ends everything** (owner chose this over "cut the link only", so nothing is
          left behind): cancel the phone's token, end every session and close its window,
          stop the service. Before doing it, both the app's Unpair and `afk unpair` warn
          plainly that this stops all AFK sessions on the laptop, and ask to confirm.
        - **A laptop restart unpairs the phone.** Every `afk pair` makes a new token and
          replaces the old pairing (one phone). Since the service only starts through
          `afk pair`, a restart leaves the old token useless.
        - Why the phone stayed connected after restarts until now: the service started at
          logon and the laptop kept the phone's token, so the phone simply reconnected.
      - Still open:
        - When the phone's old token is refused ("unauthorized"), the app should drop the
          pairing and show the pairing screen, instead of retrying. Suggested; confirm.
        - Can AFK check that Tailscale is running itself, instead of asking?
- [x] **W1-2. Name field in New session on the phone.** Let the user type the session's name
      when starting it (the folder name stays the default). The daemon already accepts a name.
- [x] **W1-3. No session ever runs hidden.** Every session started or resumed, from the laptop
      or the phone, must have a visible window on the laptop. This replaces the S7-2 decision:
      no setting to turn the windows off.
      - Follows from this (owner): a session cannot outlive its window. Closing the window
        ends the session, like any terminal, and the Ctrl+] then d detach goes away.
      - Section 13 checks 1 to 3 test today's detach (the session keeps running with no
        window). Read their results with that in mind.

## Feedback session 13 (Terminal with the keyboard open, mute, working without the phone)

Screenshots: `8.jpg` and `9.jpg` in the owner's `afk-qa-screenshots` folder, next to the repo,. Do not commit.

- [x] **S4-4 update: hiding Claude's status line is a must.** With the keyboard open it takes
      4 of the few visible terminal lines (8.jpg).
- [x] **S13-1. Terminal is hard to read with the keyboard open.** The keyboard, the reply box,
      the app's strip and the key bar leave about 10 lines, and the view jumps up (8.jpg).
      Find ways to give lines back while typing: hide Claude's status line (S4-4), make the
      strip and key bar smaller or hide them while the keyboard is open, keep the view pinned
      to the bottom. Goes with the one-input design in S5-1.
- [x] **S4-6 update: the sent prompt comes back into Claude's input.** Typed in the reply box,
      Send filled Claude's input, a second Send submitted it. Switched apps while it worked.
      On return, Claude's input held the same prompt again, under a "History 57/57" line
      (9.jpg). That line means Claude received an Up-arrow (history recall). Find what sends
      it when the app comes back (the terminal view regaining focus, or a resize).
- [x] **S13-2. Mute one session (build now, not future).** A per-session switch that stops
      notifications for that session only. Show a muted mark on its card.
- [x] **S13-3. Using AFK without the phone must keep working** (conflict with W1-1).
      The owner starts agents with `afk claude` in case they step out, and pairs only if they
      do. Sessions need the service, and W1-1 says the service starts only at `afk pair`.
      Suggested: `afk claude`, `afk codex` and `afk shell` start the service themselves when
      it is not running; `afk pair` later only adds the phone, and the sessions already
      running show up on it. **Confirmed by the owner:** any `afk` command that needs the
      service starts it when it is not running. Still never at logon.
- [x] **S13-4. Do less work while no phone is connected.** Owner asked to skip tracking until
      pairing, to cut load. Plan:
      - Pause while no phone is connected: the RAM and CPU check (every 5 s), and reading the
        agent's conversation file for the Chat tab (it is on disk, so it can be read from the
        start when a phone connects).
      - Must keep running: the copy of each session's screen (a phone that pairs later needs
        the current screen, and the laptop window reads it too), and the agent's status
        reports (keep-awake and `afk ls` use them).
      - Measure the service's CPU with and without a phone first, so the saving is known.

Order from here (owner): no more testing now. Fix the logged issues first, starting only when
the owner says go. Then test Section 13 and re-run the blocked sections.

## Section 14: Release

Deferred on purpose until after the fixes. Checks 1 to 3 publish a release (tag), and check 4 (README screenshots) should be taken after the UI changes. Do not push a tag unasked.

## Re-test round 2 (2026-11-13, new APK)

Findings from the phone re-test after the fixes. Nothing here is started until the owner
says go.

New session

- [ ] **R2-1. A session started from the phone opens no window on the laptop.** The session
      starts and works on the phone, but no window shows on the laptop.
- [ ] **R2-2. Text typed in the terminal is not carried over to Chat.** Before, text typed
      into Claude's input in Terminal showed in the Chat text box after switching tabs. Now
      the Chat box is empty.
- [ ] **R2-3. Hide "bypass permissions on" in the phone's terminal.** Show it as a chip on
      the session's card in the sessions list instead.
- [ ] **R2-4. New session stopped working.** It worked earlier in this round; later, starting
      a new session failed with a message like "Not able to connect to laptop". Some time
      later it worked again by itself. The offline banner was not showing, and the Claude
      session kept running fine at the same time, so the owner thinks the connection had
      not dropped. Look first at the New session screen and its own requests to the laptop
      (the folder list and the start request).

Pairing

- [ ] **R2-5. Move the pairing steps to the centre of the screen.** Change the layout so the
      instructions sit in the middle.

Terminal

- [ ] **R2-6. The terminal sometimes freezes.** Mostly while scrolling back through the
      output. Only going back and opening the session again fixes it.

State

- [ ] **R2-7. A cancelled prompt leaves the session on "working".** Typed into Claude's input
      in Terminal, pressed Enter by mistake, pressed Esc at once. Claude cancelled and put
      the text back (correct), but the session still shows "working", not "idle".

## Fix log

Decisions taken before the fixes (owner, 2026-11-12):

- When Claude or Codex quits, its session ends. It can still be resumed from the phone.
- A refused token makes the app drop the pairing and show the pairing screen.
- `afk pair` checks Tailscale itself and waits only when it is off.
- `afk service install` and the logon task are removed.
- AFK stops itself when the last session ends, no phone is paired and no window is connected.
- Mute is kept on the phone.
- History is not rewritten; the sample project name was renamed.

Batch 0 (scan): no keys, passwords or tokens in any commit. Personal details in old commits
(author email, Windows user and computer name, folder paths) stay, by the owner's decision.

Batch 1 (laptop), done and unit-tested:

- **W1-1, S13-3, S9-5.** No start at logon. `afk claude`, `afk codex`, `afk shell` and `afk pair`
  start AFK in the background. One phone at a time. Every start begins unpaired. `afk unpair`
  (and `afk service stop`) says what ends, asks, then unpairs, ends every session and stops AFK.
  The app's Unpair uses the same message (`daemon.stop`); the app side is in Batch 3.
- **W1-3, S7-2.** A session from the phone opens a laptop window. A session ends when its last
  laptop window closes. The detach keys are gone.
- **S4-3.** A session ends when the agent it was started for quits.
- **S3-5.** Ended sessions that cannot be resumed are removed at once.
- **S3-3.** `afk kill` takes a name or an id, or nothing inside a session.
- **S9-3.** Cause: the ended entry stayed listed after Resume, so a second Resume made
  `<name>-2`. A resumed session now replaces the ended entry. Why the session ended while the
  phone was offline is still unknown.
- **S13-4 (part).** RAM and CPU are sampled only while a phone is connected. The chat-file reading
  is unchanged until its cost is measured.
- **S9-1.** Not a bug in the laptop code: keep-awake holds only while an agent is working (plus
  the grace time). Turning it off drops the hold, and turning it on again waits for the next
  working agent. To do in the app: show "active now" or "waiting for an agent" under the switch.

Batch 1, finished later:

- **S2-2.** The laptop can be given a name from the app (Settings → Laptop, tap the name).
- The old logon task is removed from the owner's laptop and the installed `afk` is rebuilt.

Batches 2 to 5 (2026-11-12). The laptop side is unit-tested. The app side is written but **not
yet built or run**: Gradle needs the owner's go-ahead.

Causes found:

- **S4-6 (Send needs two taps).** The app sent the text and Enter together. Claude reads text
  that arrives in one piece as a paste, and a paste does not submit. Now the text goes first
  and Enter 150 ms later. Same for the reply typed in a notification.
- **S4-6 update (the prompt comes back).** A swipe on the terminal sent Up-arrow keys (the
  terminal library does that on full-screen programs), and Claude reads Up as "recall the
  last prompt". The swipe home gesture is enough to do it. A swipe on Claude's screen now
  sends nothing. Likely cause, to confirm on the phone.
- **S4-7, S4-9, S4-10 (questions).** Claude reports its own question as a permission request.
  That replaced the question, so the card and its notification lost their options. A
  question is now kept. Answers were never shown in Chat; they are now.
- **S6-2 (machine text as the user's).** The laptop showed every "user" line of Claude's
  conversation file. Sub-agent hand-backs, task notices, reminders and command output are
  now left out; a slash command shows as typed.
- **S4-5, S9-4 (missing chips).** The laptop never read the thinking level, and Claude sends
  no context share early in a session. Both are filled now.
- **S4-1 (folder picker says "Not connected").** Most likely the drive list: it looked at
  every letter A to Z, and a letter that points nowhere can hang for minutes, past the app's
  10-second wait. The laptop now asks Windows for the drives. The app also says
  "The laptop did not answer" for a wait that ran out, not "Not connected". To confirm on
  the phone.
- **S4-4 (Claude's status line).** It is the owner's own status line, run through AFK. It is
  now not drawn while a phone shows that session's terminal.
- **S12-1, S9-2 (late banner, late grey-out).** The app only noticed a dead connection when
  its 30-second check failed twice. It now hears from Android at once that the network went,
  and checks every 10 seconds.
- **S12-2 (blank screens offline).** Not explained. The app keeps the last list in memory, so
  nothing in the code blanks it. Re-test with the faster banner.
- **S9-1 (keep-awake).** Not a bug (see Batch 1). The switch now says "Keeping the laptop
  awake now" or "Waiting for an agent to start working".

What changed in the app, by item:

- **S1-1, S2-1, S2-3.** New pairing screen: three setup steps, one large Scan button. A scan
  tests and saves by itself. By hand: one **Connect** button.
- **S3-1, S5-1, S13-1.** One place to type: the terminal itself (tap it). The text box is on
  the Chat tab only. A pending question shows as a card under the terminal. With the keyboard
  open, the tabs and the strip are hidden.
- **S3-2.** A shell session has no Chat tab.
- **S5-2.** Swipe between tabs is off; Settings → Terminal turns it on.
- **S3-4.** Ended sessions have **Delete**.
- **S13-2.** Mute per session, with a "Muted" mark on the card.
- **W1-2.** Name field in New session.
- **W1-1 (app side).** Unpair warns, then ends every session and stops AFK on the laptop. A
  refused token sends the app back to the pairing screen with a note.
- **S4-2.** Pairing failures and "Chat unavailable" now show as a snackbar. The one message
  left on the screen is "The terminal stopped", because it carries a Retry button.
- **S4-8.** Settings → Notifications → Sound and vibration opens Android's own sound picker
  for each kind.
- **S6-1.** Chat: tool calls are quiet one-line rows, messages have more room, turns are set
  apart.
- **S6-3.** A slash command sent from Chat shows "Commands show their result in the Terminal
  tab" with a **Terminal** button.
- **S7-1.** The two long licence texts open on a tap.
- **S10-1.** A tap on empty space lets go of the text field.
- **S12-1.** The banner drops in from the top on every screen.
- **S1-2, S1-3.** `android\install-on-phone.ps1` builds and installs in one step and handles
  the "conflicts with an existing package" case.
- **S1-4.** The checklist's last section is now "Closing a session" (no detach keys).
- **Before you start, 4.** README and the checklist say that only sessions started with `afk`
  are listed.

- **S13-4.** Without a phone connected, the laptop looks at each chat file every 2 seconds,
  not 4 times a second. It cannot stop fully: those files also tell AFK what each agent is
  doing. When a phone connects, the files are read at once. The saving was not measured.

Design choices made without asking first (approved by the owner 2026-11-12):

- Terminal tab has no text box at all.
- The question card under the terminal is the same card as in Chat.
- The status strip moved from above the text box to under the tabs.
- Pairing: no separate Test and Save; a scan connects by itself.

Still open:

- **S9-3.** Why a session ended while the phone was offline.
- The service tests crash at random about one run in six. Cause found: this laptop runs
  Node 24.15.0, the version the README and CONTRIBUTING already warn about (a crash inside
  Node, exit code 0xC0000409). It is not from the Batch 1 changes. The same crash can stop
  AFK itself, which ends every session. Fix: install Node 24.22 or newer, or 22.23 or newer.
- The phone re-test is under way: see "Re-test round 2" above.
