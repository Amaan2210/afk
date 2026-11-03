# Android app: phone QA checklist

The app's unit tests cover its logic, but not what only a real phone shows: the camera,
notifications, the keyboard, gestures, screen readers, themes and the installed release build.
This checklist covers those. Work through it on a real phone before a release and tick every
line. Each line says what to do, then what you should see.

Anything under [Known limitations](#known-limitations) is expected behaviour. Do not file it as a
bug.

## Before you start

- [ ] On the laptop, `afk service status` says the daemon is running, and Tailscale is connected
      on both the laptop and the phone.
- [ ] With the phone connected over USB, run `.\gradlew :app:connectedDebugAndroidTest` from
      `android/`. All the instrumented sessions-screen tests pass. Do this first: it installs
      the debug build and removes the app when it ends.
- [ ] Build the release APK: from `android/`, run `.\gradlew :app:assembleRelease`. Without
      `AFK_KEYSTORE_PATH` set it is signed with the debug key. Install it with
      `adb install -r app\build\outputs\apk\release\app-release.apk`. Run the rest of this
      checklist on the release build, not the debug one: R8 shrinking problems (serialization,
      OkHttp, Hilt) only show up at run time.
- [ ] On the laptop, have running: one Claude Code session (`afk claude`), one Codex session
      (`afk codex`) and one shell session (`afk shell`), in folders that are git repositories.

## Pairing

- [ ] First launch: the splash shows the AFK icon, then the "Pair with your computer" screen.
      There is no blank or white frame in between.
- [ ] Android 13 and later: the app asks for notification permission. Allow it.
- [ ] Pair by QR: run `afk pair` on the laptop, then tap **Scan QR code**. The camera asks for
      permission the first time. The scanner works with the phone held upright and sideways.
      The scan fills in host, port and token. Tap **Test connection**: it says
      "Connected to <laptop name>". Tap **Save**: the sessions list opens.
- [ ] A notification "Connected to <laptop name>" appears and stays while the app is paired.
- [ ] Scan a QR code that is not from `afk pair`, for example any website's code. The app says
      "That QR code is not an AFK pairing code".
- [ ] Pair by hand: unpair first (see Settings below), run `afk pair` again, and type the host,
      port and token it prints. Tap **Test connection**: the app shows
      "Connected to <laptop name>". Tap **Save**: the sessions list opens.
- [ ] Pair by hand with a wrong token, then tap **Test connection**. The app says
      "Token rejected".
- [ ] Pair by hand with port `70000`, then tap **Test connection**. The app says
      "Port must be 1–65535".

## Sessions list

- [ ] The list shows every session on the laptop. Sessions that need you come first, then
      working ones, then the rest.
- [ ] The strip at the top shows the laptop's name, its RAM bar and its CPU %, and they change
      over time.
- [ ] The list updates live. Start `afk shell` on the laptop: the new card appears within a
      second or two. End it with `afk kill <id>`: its card shows "Ended".
- [ ] Each card's state, age and last message follow the agent. Give the Claude session a
      prompt: its card reads "Working · …", then "Finished".
- [ ] Search for part of a session name, a folder or a branch. Only matching cards stay.
- [ ] The state chips (All, Needs you, Working, Done) and the agent chips filter the list. The
      counts on the state chips do not change when you filter.
- [ ] Long-press a card: the sheet offers Rename and Kill, and Resume for an ended agent
      session. Rename shows the current name. Kill asks first. Resume opens the new session.
- [ ] Double-tap a card quickly. The session opens once, and Back returns to the list in one
      press.
- [ ] Compare the list with `docs/design/mockups/01-core-screens.html` (spacing, colours,
      left-edge agent colour). It matches closely.

## Notifications

To get a question from Claude Code, give it a prompt such as "Use the AskUserQuestion tool to
ask me which of three colours I like". To get a permission prompt, start `afk claude` without
`--dangerously-skip-permissions` and ask it to create a file.

- [ ] Put the app in the background, then have Claude ask a question with two options. The
      "Needs your input" notification shows the two options as buttons and a **Reply** button.
      Tap an option: Claude gets that answer, and the notification goes away.
- [ ] Same with a question that has three or more options. The notification shows the first two
      options and **Reply**. Tapping the notification body opens the session with the question
      card.
- [ ] Answer a question with **Reply** and some text. Claude gets the text as its answer.
- [ ] A permission prompt shows **Allow**, **Deny** and **Open**. **Allow** lets Claude go on.
- [ ] Answer a question on the laptop while its notification shows on the phone. The
      notification goes away. Same when you answer it in the app.
- [ ] When Claude finishes a turn, a "Finished" notification arrives with an inline **Reply**.
      Type a prompt there: it is sent to the session, followed by Enter, and Claude starts
      working.
- [ ] When a sub-agent finishes, a notification arrives on the "Sub-agents" channel. If a
      question of the same session is waiting, its notification stays too.
- [ ] No notification arrives for the session you have open on screen. Open a session, make it
      finish: no notification. Go back to the list, make it finish again: the notification
      arrives.
- [ ] Settings → Notifications: turn off **Finished**. Finished notifications stop, and the
      other kinds still arrive. Turn it back on.
- [ ] Restart the phone. Without opening the app, the "Connected to …" notification comes back
      and session notifications arrive.

## Terminal

- [ ] Open the Claude session. The Terminal tab shows the same screen as the laptop window,
      colours included.
- [ ] Type into the terminal with the phone keyboard. The text appears on the laptop and the
      phone at the same time.
- [ ] Rotate the phone once. The terminal redraws to the new width once, and the laptop window
      reflows once too, not repeatedly.
- [ ] Resize the laptop window while the phone shows the terminal, then switch to Chat and back
      to Terminal. The terminal fits the phone's screen again.
- [ ] Key bar: Esc, Tab and the arrows reach the program. In the shell session, Up recalls the
      last command.
- [ ] Ctrl: tap **Ctrl**, then type `c` on the phone keyboard. The running command stops, as
      with Ctrl+C. Ctrl is no longer highlighted afterwards.
- [ ] Ctrl with Gboard: tap **Ctrl**, then type a letter. The letter does not show up later in
      the composer or the terminal.
- [ ] The keyboard key shows the phone keyboard, with the terminal focused. Tap it again: the
      keyboard hides.
- [ ] Long-press terminal text: a selection with Copy appears. Copy it, then paste it into
      another app: the text matches.
- [ ] Long-press → Paste in the terminal pastes the clipboard into the session as typed text.
- [ ] A program's own clipboard request (OSC 52) does not change the phone's clipboard. In the
      shell session on the phone, run
      `Write-Host -NoNewline "$([char]27)]52;c;YWZrLW9zYzUy$([char]7)"`, which asks the terminal
      to copy the text `afk-osc52`. Paste into another app: it is not `afk-osc52`.
      If the daemon does not relay the sequence, nothing reaches the phone and this check
      passes without proving anything; write that down instead of ticking it.
- [ ] Swipe sideways on the terminal. The view moves between Terminal and Chat, and a
      long-press selection still works.
- [ ] Pinch to zoom, quickly and several times. The font grows or shrinks one step at a time and
      stops where you stop. Settings → Terminal → Font size then shows the same size.
- [ ] Use the Claude session from the phone for a few minutes: type, switch tabs, rotate. No
      stray characters such as `^[[…` appear in Claude's input box. If they do, they are the
      terminal answering a query from the program: note what it was doing and report it.

## Chat

- [ ] Open the Claude session's Chat tab. Your prompts, Claude's replies, tool calls and
      sub-agents show as in the mockup: bubble widths, the Codex accent edge on Codex sessions,
      tinted cards.
- [ ] Tap a tool card. It expands to show the input and the result, and **Show more** shows the
      rest of a long result. A tool with a very long name (an MCP tool) still shows part of its
      summary.
- [ ] Long-press one of your messages, then one of Claude's. Each time, a text selection
      appears: select part of the text, tap **Copy**, and paste it into the composer. The pasted
      text matches what you selected.
- [ ] When Claude asks a question, the chat shows a question card. Tap an option: Claude gets
      that answer.
- [ ] A multi-select question shows checkbox rows and **Confirm**. Tick two, confirm: Claude
      gets both.
- [ ] While a multi-select question is pending, type something in the composer and tap Send.
      Nothing reaches Claude, the text stays in the composer, and the app says "Answer the card
      above".
- [ ] Tap an option of a question card. Its options grey out, and tapping one again does
      nothing.
- [ ] Tap **Other…** on a question card. The composer gets focus and says "Your answer…". Type an
      answer and send it: Claude gets it as the answer.
- [ ] With a question that offers **Other…** pending, send an empty composer. The app shows
      "text must not be empty".
- [ ] Tap a sub-agent card. The sub-agent's thread opens, titled with its task, and Back
      returns to the session.
- [ ] Follow the bottom: at the end of the chat, new messages scroll into view. Scroll up and
      wait for a new message: the list stays where you are. Scroll back to the end: it follows
      again.
- [ ] At the end of the chat, open the keyboard. The list stays at the end and the composer
      stays above the keyboard.
- [ ] At the end of the chat, touch the list and lift your finger without scrolling, then wait
      for a new message. The list still follows the bottom.

## Navigation

- [ ] Go through every screen at least once: list → session (both tabs) → sub-agent thread →
      back; list → new session → back; list → Settings → About and licenses → back. Every
      Back arrow and the system Back go one screen back.
- [ ] Tap a session notification with the app closed (swiped away from Recents). The app opens
      on that session.
- [ ] Tap a session notification with the app in the background. That session opens, and Back
      goes to the list.
- [ ] Tap a session notification while the app shows another session. The notified session
      opens, with an empty composer, not the other session's draft.
- [ ] Type a draft in a session and switch to the Chat tab, then tap a notification for that
      same session. The draft and the tab stay as they were.
- [ ] Open a session's sub-agent thread, then tap a notification for that session. The session
      shows, and Back goes to the list.
- [ ] Tap the "Connected to …" notification while the app is in the background. The app comes
      to the front, and Back leaves it: there is no second copy of the app behind it.
- [ ] Unpair, pair again inside the app, then tap a session notification. The session opens.
- [ ] In a session's ⋮ menu, tap **Resume** on an ended agent session. The new session opens.
- [ ] Double-tap a Back arrow quickly. You go back one screen, and the app does not end up on a
      blank screen.

## New session

- [ ] Tap **New session**, choose a folder (recent folders, or browse from the drives), choose
      **Shell**, then tap **Start session**. The session opens. Type `dir` in the terminal: it
      lists the folder.
- [ ] New Claude session with a first prompt: choose a folder, **Claude**, type a prompt, then
      tap **Start session**. The session opens, and Claude starts working on the prompt.
- [ ] Switch the agent to **Codex**. The `--dangerously-bypass-approvals-and-sandbox` chip is
      selected by default. Its long label stays readable at the phone's width: it does not
      overlap the next chip or get cut mid-word. Note how it looks if it wraps.
- [ ] Browse into a folder with no sub-folders. The picker says "No sub-folders here — tap ✓ to
      use this folder".
- [ ] Turn on the flag that takes a model. A **Model** field appears, and the keyboard does not
      autocorrect what you type.

## Settings

- [ ] Settings → Laptop shows the laptop's name and "Connected · <address>".
- [ ] Turn on **Keep laptop awake while agents work** while an agent is working. On the laptop,
      in an administrator PowerShell, `powercfg /requests` lists the daemon (`node.exe`) under
      SYSTEM: the laptop reports keep-awake as active. Turn the switch off: the entry goes away.
- [ ] Turn off the phone's Wi-Fi and mobile data. The keep-awake switch greys out until the
      connection is back.
- [ ] Settings → Terminal: the font size and **Key bar** change the terminal at once.
- [ ] Settings → Status strip: a chip you turn off disappears from the session screen's strip.
- [ ] Settings → About and licenses opens a screen with the version, the source link and the
      Termux licence text. **Source** opens the repository in the browser.
- [ ] Settings → Laptop → **Unpair**. The confirmation says the laptop still lists this phone
      until you run `afk unpair` there. Confirm. The app returns to the pairing screen, and
      the "Connected to …" notification disappears because the service has stopped. On the
      laptop, `afk devices` still lists the phone until you run `afk unpair <deviceId>`.

## Theme & icon

- [ ] Settings → Appearance: switch through Graphite, Ember, Aurora and Phosphor, each in Light
      and in Dark. Every screen changes at once, with no restart, and stays readable.
- [ ] Android 12 and later: **Dynamic** is offered and takes its colours from the wallpaper. On
      Android 11 or older, Dynamic is not offered.
- [ ] Mode **System** follows the phone's dark mode as it changes.
- [ ] Status-bar icons are readable in all four combinations: app Light or Dark, phone light or
      dark.
- [ ] **Always dark terminal** keeps the terminal dark in Light mode.
- [ ] In Light mode on a light phone, the text-selection toolbar (long-press in a text field) is
      light.
- [ ] Cold-start the app with Aurora selected. There is no flash of the Graphite colours before
      the first screen.
- [ ] The launcher icon, the round icon and the themed icon (Android 13 and later, with themed
      icons turned on) all look right. The notification's small icon is the AFK mark.

## Accessibility

- [ ] Turn on TalkBack. On a session card it reads the name, age, state and last message, says
      it is a button, and offers "Session actions" for the long-press.
- [ ] TalkBack reads a session's state once, from the card's text (or the session screen's
      subtitle), not a second time for the coloured dot.
- [ ] Every icon button reads a label: Settings, Back, Close, Send, Session actions, Use this
      folder. The key bar keys read "Escape", "Control" and so on.
- [ ] The **About and licenses** row and the About screen's **Source** row read as buttons.
      Switch rows read as switches, with their on or off state.
- [ ] In the chat, a multi-select question's rows read as checkboxes, ticked or not ticked, and
      a tool card reads as "Expanded" or "Collapsed".
- [ ] With TalkBack on, turn off Wi-Fi. The offline banner's text is announced without moving
      focus.
- [ ] Set the phone's font size to the largest. All text grows, and nothing important is cut
      off on the list, session, new-session and settings screens.

## Offline / reconnect

- [ ] Turn off Wi-Fi and mobile data. Within about a minute, a banner under the top bar says
      "Reconnecting to <laptop name>… (attempt n)", and n counts up. The last known list stays,
      and you can still scroll it and open sessions.
- [ ] While still offline, send from a session's composer, then try to start a new session. Both
      show "Not connected" instead of hanging, and the composer keeps its text.
- [ ] Turn the network back on. The banner disappears, and the list catches up with changes made
      while offline.
- [ ] Stop the daemon (`afk service stop`). The banner shows reconnecting attempts. Start it
      again (`afk service start`): the banner goes away. Stopping the daemon ended every
      session, so start one again on the laptop (`afk shell`); it appears in the list.
- [ ] Revoke the phone on the laptop (`afk devices`, then `afk unpair <deviceId>`), then make
      the phone reconnect by turning Wi-Fi off and on. The banner says
      "Connection refused: unauthorized".
- [ ] Pair again: in the app, Settings → Laptop → **Unpair**, then run `afk pair` on the laptop
      and scan the code. Until you do, the phone shows "unauthorized" (or the pairing screen,
      once unpaired). After pairing, the list shows the laptop's sessions again.

## Release

- [ ] Push a tag `vX.Y.Z` that matches `versionName` in `android/app/build.gradle.kts` and the
      service's `package.json`. The release workflow's `android` job passes its "Tag matches
      versionName" step and attaches `afk-vX.Y.Z.apk` to the GitHub Release for the tag.
- [ ] Uninstall AFK first (this forgets the pairing), install the CI APK, then pair again: on the
      phone, download that APK and open it, allowing the browser to install unknown apps when
      asked. It installs and runs, and pairing works as above.
- [ ] With the four repository secrets `ANDROID_KEYSTORE_B64` (the keystore file in base64),
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` set,
      `apksigner verify --print-certs` on the released APK shows your release certificate, not
      "CN=Android Debug".
- [ ] Capture the README screenshots from the phone in Aurora, Dark mode, and save them as
      `docs/screenshots/sessions.png`, `terminal.png`, `chat.png`, `question.png` (a question
      card in the chat) and `settings.png`. The README's Android section then shows them.

## Known limitations

These are expected. Do not file them as bugs.

- Nested sub-agent threads replace the parent thread: Back from a nested thread goes to the
  session, not to the parent thread, and a nested sub-agent is titled "Sub-agent". Today's
  daemon does not send nested threads.
- A mouse-wheel scroll or a TalkBack scroll never unpins the chat. The next message brings the
  list back to the end.
- Platform popups, such as the text-selection toolbar, follow the phone's night mode, not the
  app's Mode setting.
- An app forced to Dark on a light phone can flash light briefly before its first screen draws.
- After you leave the app with Back, opening it from Recents can reopen the session a
  notification last opened.
- A question with three or more options shows only its first two options and **Reply** in the
  notification, or its first three options when it takes no typed answer. A multi-select
  question gets no answer buttons. Open the session for the rest.
- On a cold start, the offline banner can show "Not connected" for a moment, before the
  connection service has started connecting.
- Ctrl+arrow on a hardware keyboard leaves the on-screen Ctrl armed.
- A chat error after the daemon refuses the stream stays until the chat reconnects (leave the
  session for more than 5 seconds); a chat that timed out retries by itself about every ten
  seconds while the laptop stays silent. There is no Retry button.
- A sub-agent's thread screen has no composer. Answer its questions with text from the session
  screen.
- Android refuses to install an APK over the installed app when the two are signed with
  different keys. That happens with a CI build over a local build, with debug-signed CI builds
  from different runners (no keystore secrets), and with the first release signed with the real
  key over a debug-signed install. Uninstall first, which forgets the pairing.
