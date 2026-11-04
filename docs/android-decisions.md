# Android app: decisions made during the build

Why the code is the way it is, where the plan or the spec left a choice or where a review changed
course. Grouped by area, not by task. Each entry says what was decided and why; where the choice
could reasonably go the other way, the cost of switching is noted.

## Protocol and connection

- **The transport is plain `ws://` and the manifest allows cleartext traffic.** The spec makes
  Tailscale (WireGuard) the encryption layer; Android 9+ refuses cleartext without the attribute,
  so without it the app never connects on a real phone. JVM tests cannot see this because
  MockWebServer runs on the JDK platform.
- **`ConnectionManager`, `SessionsRepository` and `AfkSocket` are interfaces** with default
  implementations, so view models, the service and the connection manager can be tested with
  fakes and under virtual time.
- **An error message without a request id is a notice, not a request failure.** Only the two
  handshake rejections (`unauthorized`, `protocol_mismatch`) end the connection as `Failed`; they
  also fail every pending request with a typed error.
- **A frame that fails to decode is dropped and surfaced as a decode-failure event;** the socket
  stays open. No `android.util.Log` in connection classes, which keeps JVM tests clean. Frames
  are decoded on the default dispatcher, unmeasured; it costs nothing to keep.
- **The connect loop has no current-loop guard.** `stop()` writes Disconnected and the cancelled
  loop's `finally` writes it again, but a `StateFlow` drops a value equal to its current one, so
  collectors see one. A replacing `start()` passes through Connecting on purpose.
- **One OkHttp client with a 30-second ping** detects dead connections; the connection factory
  takes a coroutine scope so each pairing test connection owns and cancels its collectors.
- **Pairing payloads are validated where entered:** a port outside 1..65535 and a blank host or
  token are rejected; any other unusable endpoint ends as `Failed("bad_endpoint")`.
- **Daemon settings come from any settings message, with or without an id;** the app never asks
  for them on connect. They are cleared whenever the connection leaves `Connected`, so the
  Keep-awake switch disables offline.
- **On disconnect the last known session list is kept** (the spec's offline behaviour); the next
  snapshot replaces it. Chat and terminal streams re-subscribe on reconnect through ref-counted
  holders, so one daemon subscription serves every collector of the same stream.
- **A request timeout becomes a typed `timeout` error;** an `Error` reply fails the stream with
  the daemon's code. User-facing text rewords `not_found` and `pending_changed` after an answer
  as "the prompt changed".
- **Protocol enums keep the lowercase wire names** (`needs_input`, `shell`); ktlint's enum-case
  rule is disabled for that folder. `java.util.Base64` (API 26+) decodes terminal data.
- **The protocol models mirror protocol.md fully**, including the three device messages the app
  never sends, because the examples test decodes every example.

## Service and notifications

- **Foreground service type `connectedDevice`** with its prerequisite permission; it may start on
  boot, which `dataSync` cannot, and has no six-hour cap on Android 15.
- **The service subscribes to notifications before it starts the manager, stops the manager
  before a replacing start, stops itself when unpaired, and re-posts its own notification on
  every state change.** The main activity starts it on every non-null pairing value, so pairing
  inside the app starts it too. A pairing read failure counts as "no pairing" everywhere.
- **A notification carries at most three actions:** a free-text question gets two choices plus
  Reply; a choices-only question up to three choices; multi-select Open only; a permission
  Allow/Deny/Open; a finished session Reply/Open. The body tap always opens the session.
- **Reply on a question answers the question as free text; Reply on a finished session types
  into the terminal.** Channel importances: questions high, finished default, sub-agents low,
  connection silent. Channel ids never change.
- **One notification id per session, with a separate tag for sub-agent notifications**, so a
  sub-agent finishing does not replace an actionable question. The service cancels a session's
  question notification when its prompt is answered anywhere, including on the laptop.
- **The foreground tracker is owner-based.** The session screen and its sub-agent thread screen
  both claim the same session id; the most recent live claim wins and out-of-order release is
  safe (predictive back can pause the session screen after the thread resumed). The notifier
  suppresses notifications for the current claim, and the service cancels both of a session's
  notifications whenever its screen comes to the front: Open buttons do not auto-cancel, and
  nothing else ever removed a sub-agent notification.
- **The notification icon is the white launcher glyph** (`ic_stat_afk`); the launcher icon is a
  vector adaptive icon with a monochrome layer, no PNG mipmaps. A Robolectric test inflates every
  icon because release lint does not fail on a malformed vector path.

## Navigation and lifecycle

- **String routes and a strict deep-link parser** (`afk://session/<id>` with one path segment of
  `[A-Za-z0-9._-]{1,64}`), not Navigation's own deep-link matcher; `intent.data` is untrusted.
- **A pure, tested decision function handles deep links:** pop to an existing entry for the same
  session, else navigate single-top above the list. Needed because Navigation 2.10 applies
  pop-up-to before single-top. Every forward navigation is single-top; back arrows ignore double
  taps; notification intents reuse the running task.
- **A deep link is dropped only while the Pairing screen is showing**, not while the start
  destination is Pairing; otherwise every notification tap after in-app pairing would be ignored
  until the process died.
- **The start destination comes from one read of the pairing;** an I/O error means Pairing; a
  corrupt prefs file is replaced with empty prefs rather than crashing. The splash stays up until
  the destination is known.
- **One-shot events (errors, resumed and created ids) are buffered channels**, collected once per
  screen. One-slot flows lost a second error during a snackbar and anything emitted across a
  rotation; callbacks held across a request called into a dead composition.
- **The session view model owns the terminal bridge** so the terminal survives rotation; it
  attaches on start and detaches on stop, and re-sends the view's grid when it differs from the
  emulator's (another client may have resized the PTY).
- **The chat stream lives in a `ChatEvents` helper** shared while subscribed, with the list
  nullable until the first snapshot so the empty state never flashes. A subscribe timeout
  retries after a wait that doubles from 10 seconds to a minute, and then once the connection is
  `Connected`; a daemon refusal does not retry.

## Terminal

- **The Termux emulator and view are vendored, not depended on**, from tag v0.118.3, with the
  native code dropped: the JNI class is a stub that never loads a library and throws if called.
  Seven `// AFK:` edits are listed in each module's AFK-CHANGES.md.
- **`isTerminalViewSelected()` returns true as Termux does;** returning false made the keyboard
  autocorrect keystrokes.
- **Terminal colours follow the app palette** with an always-dark option; the font size persists
  through the settings store so pinch and slider agree; the key bar can be hidden.

## Chat and questions

- **Markdown is a small line-based parser**, no library: links show their label only, headings
  and nested lists stay plain, an unclosed code fence runs to the end (CommonMark), unclosed
  inline markers stay literal, code spans are split before other inline formatting.
- **While a free-text question is pending, Send answers it on both tabs;** the agent is blocked,
  terminal text is ignored and Enter would confirm the first option. While a choices-only
  question or a permission is pending, Send does nothing and shows a hint. That hold is kept even
  though a pending the daemon never cleared would leave the composer refusing to send: that needs
  a daemon bug first, and the key bar and the cards still work.
- **"Other…" only focuses the composer** and is hidden for multi-select questions and on the
  thread screen (no composer there). Answered single-select cards disable their options.
- **Auto-follow uses a pinned flag that only user drags change;** new rows jump rather than
  animate to the bottom, because an interrupted animation strands the list short of it.
- **Turn-end events get no row;** tool names are one line with an ellipsis and capped at 160 dp
  so a long MCP name cannot squeeze out the summary.

## Sessions list and new session

- **Chip counts ignore filter and search; "Working · 14m" is timed in the repository** from
  observed state changes (the daemon's activity stamp moves on every output chunk), so the list
  and the session screen agree.
- **The list view model seeds its first state from the repository's current values**, so a new
  view model does not flash "Not connected" and an empty list while the service is connected.
- **Kill is hidden for ended sessions;** a resume ignores a second tap while one is in flight.
- **No name field on the new-session form:** the daemon names a session after its folder and
  the list can rename it. Claude chips are skip/continue/model (`--continue`, not `--resume`,
  which opens Claude's own picker); default flags are Claude {skip}, Codex {yolo}, shell none, and
  switching kind resets them. Shell sends no arguments and no prompt.
- **The folder picker lists drives at the root and recent folders first;** Up from a drive root
  lists the drives again; a browse in flight shows a progress row; the daemon's rejection of a
  relative or missing folder shows a snackbar and keeps the sheet open.
- **A create timeout says the session may have started;** the daemon may have created it before
  the reply was lost.

## Settings, theme and resources

- **App settings share the pairing prefs file under `settings.` keys;** a test proves settings
  writes never touch the pairing keys. A read error retries every second rather than ending the
  stream. Enums are stored by name, strip chips as an ordered comma list, font clamped 10..20.
- **Every Material colour slot is mapped from the palette;** error stays Material's red because
  the palette has no red token. The mockup's extra terminal tokens are not modelled.
- **System-bar icon colour follows the app's dark flag, not the phone's,** re-applied whenever
  the resolved mode changes. The day theme parents the Light platform theme so platform popups
  are light in light mode; night parents the dark one.
- **Unpair confirms, clears the pairing, stops the service and returns to Pairing;** the dialog
  says the laptop still lists the phone until `afk unpair` runs there.
- **The About screen loads the licence texts from assets off the main thread** and credits both
  vendored directories in one notice; the Settings row is "About and licenses".
- **Every other bundled library is credited from a Kotlin list, not an asset manifest:** name,
  owner and a source link per library, so a unit test can check the entries. All of them are
  under the Apache License 2.0, so its text is packaged once (`licenses/APACHE-2.0.txt`) and
  shown once, under the library rows. Test and debug-only dependencies do not ship and are not
  listed. Okio and ZXing core are listed although they arrive transitively, because they are in
  the APK.

## Build, tests and CI

- **AGP 9.1.1 stays** because the installed Android Studio cannot open a newer one; AGP 9
  compiles Kotlin itself, so the Kotlin Android plugin is not applied. compileSdk and targetSdk
  are 37, the Java target is 17, the Gradle wrapper pins its distribution checksum.
- **CI runs on JDK 21** because Robolectric's Android 36 and 37 runtime jars are Java 21 bytecode.
- **Tests fake at the interface boundaries** and run on the JVM; the terminal bridge, icons and
  receivers run under Robolectric; the single Compose UI test is compiled in CI and run on a phone
  during QA. Fixtures use the hostname MY-LAPTOP.
- **No file-length rule.** The reviews flagged files over 200 lines as a heuristic; the five that
  are over it (the sessions repository, two view models, two screens) each hold one mechanism or
  one screen's state, and a split for the number alone would scatter them.
- **The release job tests before it builds**, checks the tag against `versionName`, signs with the
  keystore from secrets when present and the debug key otherwise, and attaches `afk-<tag>.apk` to
  the GitHub release.
