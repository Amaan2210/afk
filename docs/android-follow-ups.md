# Android app: follow-ups, deferred items and known limitations

State as of `main` after the Android plan landed (2026-11-03). Everything here was found by the
per-task reviews, the final whole-branch review or its re-review and was judged not worth another
fix round before phone QA: none of it is user-visible in normal use. Items are grouped by what
they need.

## Needs a decision

- **Release signing.** Without the `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets, the release job signs with the runner's
  throwaway debug key, so one release APK will not install over another. Add the secrets before
  the first real tag. The job refuses a tag that does not match `versionName` (`0.1.0`).
- **Phone QA.** `docs/qa-checklist-android.md` is the hand-over; the five README screenshots
  (`docs/screenshots/*.png`, Aurora dark) are captured during it.

## Follow-ups in code

1. **Chat retry cadence.** After a subscribe timeout, `ChatEvents` waits for the connection to be
   `Connected` and retries; while connected that is immediate, so the chat re-subscribes about
   every ten seconds for as long as the daemon stays silent and the page is shown. Bounded by the
   request timeout, but not tied to a reconnect as the KDoc says. Consider waiting for a real
   reconnect, or a backoff.
2. **Unpair still hands the screen a callback.** `SettingsViewModel.unpair(onDone)` is the pattern
   the fix wave removed from resume and create; a rotation during unpair calls the old screen's
   lambda. Emit an event instead.
3. **"Open" action buttons do not dismiss their notification.** Only a tap on the body does. This
   now also applies to the separate sub-agent notification, which nothing cancels.
4. **Answering a question can cancel an older "finished" notification** for the same session if
   it is still in the tray (the cancel keys on the session, not the prompt). Acceptable today; a
   per-prompt tag would fix it.
5. **Send is held while a permission prompt waits.** Correct (Enter would confirm whatever the
   prompt highlights), but a pending the daemon never clears would leave the composer refusing to
   send. The key bar and the cards still work.
6. **No current-loop guard in `DefaultConnectionManager`.** `stop()` writes Disconnected and the
   cancelled loop's `finally` writes it again; a replacing `start()` passes through Connecting by
   design. Cosmetic.
7. **Frame decoding on the default dispatcher.** `flowOn(Default)` is unmeasured; an undecodable
   snapshot leaves the terminal blank until re-attach (needs a daemon bug first).
8. **The font slider resets on any failed settings save**, not only a failed font save
   (`TerminalSection` keys on the shared failure counter). Rare, cosmetic.
9. **Test wording nits** and the `ServerMessage.Error` name shadowing `kotlin.Error`; a
   refactor-only note on the connection manager's request map.
10. **Four files are over 200 lines:** `DefaultSessionsRepository`, `SessionViewModel`,
    `SessionScreen`, `SettingsViewModel`. Mechanical splits.
11. **Two tests are weaker than their names:** the "detaches" half of
    `clearingDetachesTheTerminalAndReleasesTheForeground` passes without the detach because
    cancelling the scope stops the terminal anyway; `aSubAgentsEndKeepsTheQuestionsNotification`
    builds its notifications by hand rather than through `SessionNotifier`.
12. **Judge in QA:** terminal contrast of some palette tokens; the offline banner's live region
    announcing every reconnect attempt (backoff up to a minute); a very fast second tap on Start
    while the app is already moving to the new session.

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
  chat retries by itself. There is no Retry button.
- A sub-agent's thread screen has no composer; free-text answers to its questions are typed from
  the session screen.
- Any APK signed with a different key refuses to install over the existing app (a CI build over a
  local build, or the first real-key release over a debug-signed install): uninstall first, which
  forgets the pairing.
