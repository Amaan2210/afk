# How AFK works

AFK on the laptop runs every session. The phone and the laptop windows show a session and type
into it. Nothing runs at logon, and no session runs without a window on the laptop.

## 1. When AFK runs

- AFK starts in the background, with no window, when you run `afk claude`, `afk codex`,
  `afk shell` or `afk pair`.
- It stops when you unpair, or by itself once the last session has ended and no phone is paired.
- Stopping it ends every session. After a laptop restart, run `afk pair` again.

## 2. Pairing

1. On the laptop, run `afk pair`. It starts AFK, waits for Tailscale if it is off, and prints a
   QR code with the host, the port and a token.
2. In the app, tap **Scan QR code**. The app tests the code and opens the sessions list.
   Typing the three values and tapping **Connect** does the same.
3. The token is shown once. The laptop keeps only a hash of it.
4. One phone is paired at a time. Pairing again replaces the phone paired before.

## 3. The connection

- The phone keeps one connection to the laptop over Tailscale, also while the app is closed.
- The laptop then sends the session list, its stats and its settings, and live updates.
- If the connection drops, a banner drops in from the top and the phone retries after pauses
  that grow. Losing Wi-Fi or mobile data shows the banner at once. Sessions keep running.
- A token the laptop no longer accepts sends the app back to the pairing screen.

## 4. Unpairing

**Unpair** in the app and `afk unpair` on the laptop do the same, after a warning:

1. The phone's token is cancelled.
2. Every session ends and its window closes.
3. AFK stops.

If the app is not connected, Unpair only makes the app forget the laptop.

## 5. Starting a session

- **From the laptop:** run `afk claude`, `afk codex` or `afk shell` in a folder. The session
  starts in that window.
- **From the phone:** tap New session, then pick the folder, a name (optional), the agent and
  its flags. A window for the session opens on the laptop.
- AFK shows only the sessions it started. A `claude` started without `afk` is not listed.

## 6. While a session runs

- The phone and the laptop window show the same terminal.
- While the phone shows a session's terminal, Claude's own status line is hidden there. The
  app's strip shows the same facts.
- Keep-awake holds the laptop awake while an agent works, and lets go about 10 minutes after
  the last agent stops. You can change that time.
- A muted session sends no notifications. Mute is kept on the phone.

## 7. Ending a session

A session ends when:

- its laptop window closes,
- its agent (Claude or Codex) quits,
- you kill it (`afk kill`, or Kill in the app),
- AFK stops.

Ended Claude and Codex sessions stay listed for 24 hours so they can be resumed. **Delete**
removes one sooner. Ended shell sessions are removed at once.

## 8. Resuming

- Resume starts a new session in the same folder, on the same conversation, and opens a window
  for it on the laptop.
- It takes the ended session's place in the list and keeps its name.
