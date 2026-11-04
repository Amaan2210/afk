# Android app: follow-ups, deferred items and known limitations

State as of `main` on 2026-11-04. Everything here was found by the per-task reviews, the final
whole-branch review or its re-review. The items judged not worth a fix round before phone QA were
worked through afterwards, one at a time: what was fixed, what was kept and why, and what only a
phone can judge. Items are grouped by what they need.

## Needs your action

- **Release signing.** Without the `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets, the release job signs with the runner's
  throwaway debug key, so one release APK will not install over another. Create the keystore and
  add the secrets before the first real tag, as `docs/releasing.md` describes. The job refuses a
  tag that does not match `versionName` (`0.1.0`).
- **Phone QA.** `docs/qa-checklist-android.md` is the hand-over; the five README screenshots
  (`docs/screenshots/*.png`, Aurora dark) are captured during it.

## Fixed after the final review

1. **Third-party licences.** The About screen credits every bundled library, from a Kotlin list,
   with the Apache License 2.0 text shown once.
2. **Chat retry cadence.** After a subscribe timeout the chat waits 10 seconds, then 20, 40 and
   60, and only then for the connection; before, while connected, it asked a silent daemon again
   every timeout.
3. **Unpair reports through an event**, not a callback the screen handed in, so a rotation during
   the unpair cannot call into the old screen.
4. **Open buttons and sub-agent notifications.** A session coming to the front cancels both of its
   notifications, so Open removes the notification it was on, and the sub-agent notification goes
   when the session is opened. This also removes the case where answering a question could cancel
   an older "finished" notification: such a notification only outlives a question while the
   session is on screen, which now clears it first.
5. **The font slider resets only when a font size could not be saved**, not on any failed save.
6. **Two tests say what they prove:** the clearing test no longer claims to test detach (the
   bridge tests do), and the pending-answer test checks the exact JSON keys, not the absence of
   the word "null". The sub-agent tag test builds its notifications through the notifier.

## Kept as is

- **Send stays held while a permission prompt waits.** Enter would confirm whatever the prompt
  highlights. A pending the daemon never clears would leave the composer refusing to send, but
  that needs a daemon bug first, and the key bar and the cards still work.
- **No current-loop guard in `DefaultConnectionManager`.** `stop()` writes Disconnected and the
  cancelled loop's `finally` writes it again, but a `StateFlow` drops a value equal to the current
  one, so no collector sees two. A replacing `start()` passes through Connecting by design.
- **Frame decoding on the default dispatcher** is unmeasured but costs nothing to keep; an
  undecodable snapshot leaving the terminal blank until re-attach needs a daemon bug first.
- **`ServerMessage.Error` shadows `kotlin.Error`.** It is only ever written qualified; renaming a
  protocol model for a name clash that never bites is churn.
- **Files over 200 lines** (`DefaultSessionsRepository` 324, `SessionViewModel` 232,
  `SettingsViewModel` 219, `AboutScreen` 211, `SessionScreen` 208). The bar was a review
  heuristic, not a project rule, and no split improves cohesion: the repository's subscription
  ref-counting, relay and session reduction are one mechanism, and the view models are one
  screen's state each. Worth a mechanical commit only if the files keep growing.

## Judge in QA

- Terminal contrast of some palette tokens.
- The offline banner's live region announcing every reconnect attempt (backoff up to a minute).
- A very fast second tap on Start while the app is already moving to the new session.

## Known limitations

Documented in the checklist so they are not filed as bugs:

- Nested sub-agent threads replace the parent thread rather than stacking.
- Mouse-wheel and TalkBack scrolls never unpin the chat from the bottom; only touch drags do.
- Platform-drawn popups (text-selection toolbar, the terminal's copy/paste menu) and the window
  background follow the phone's night mode, not a theme forced in Settings.
- Recents can reopen a deep-linked session (standard Android task behaviour).
- A question with three or more options shows two choices plus Reply in its notification; the
  rest are answered in the app.
- A momentary "Not connected" banner on a cold start, before the service starts connecting.
- Ctrl+arrow on a hardware keyboard leaves the on-screen Ctrl armed.
- A chat error after the daemon refuses the stream stays until the chat reconnects; a timed-out
  chat retries by itself, waiting longer each time. There is no Retry button.
- A sub-agent's thread screen has no composer; free-text answers to its questions are typed from
  the session screen.
- Any APK signed with a different key refuses to install over the existing app (a CI build over a
  local build, or the first real-key release over a debug-signed install): uninstall first, which
  forgets the pairing.
