# AFK Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the native Android app that pairs with the AFK daemon over Tailscale, lists sessions, mirrors a session's terminal, renders it as chat, answers questions, starts new sessions, and raises its own notifications.

**Architecture:** Single-activity Jetpack Compose app. A foreground service owns one WebSocket to the daemon and feeds a `SessionsRepository` that every screen reads through ViewModels. Protocol messages are kotlinx.serialization models mirroring `protocol/protocol.md`; the terminal is Termux's emulator and view, vendored and adapted so the emulator is fed from the socket rather than a local process.

**Tech Stack:** Kotlin 2.x, AGP 8.x, Compose BOM + Material 3, Navigation Compose, kotlinx.serialization, OkHttp WebSocket, DataStore Preferences, Hilt (KSP), Termux terminal-emulator/terminal-view (Apache-2.0, vendored), zxing-android-embedded, JUnit 4 + kotlinx-coroutines-test + Turbine + Robolectric + MockWebServer, ktlint.

**Spec:** `docs/superpowers/specs/2026-10-30-afk-design.md` (§9 notifications, §10 app). Protocol: `protocol/protocol.md`. Visual reference: `docs/design/mockups/*.html`.

## Global Constraints

- `applicationId` and root package: `io.github.amaankhan63.afk`. Project dir `android/`, module `app`.
- `minSdk = 26`, `targetSdk` = latest stable, `compileSdk` = same.
- Protocol version `1`; default port `2350`; endpoint path `/ws`. The app must ignore unknown message types and unknown fields.
- No third-party push service. Notifications come only from the foreground service's socket.
- Notification channel ids exactly: `needs_input` (IMPORTANCE_HIGH), `finished` (IMPORTANCE_DEFAULT), `subagents` (IMPORTANCE_LOW, off by default), `connection` (IMPORTANCE_MIN).
- Reconnect backoff: first delay ≤ 1 s, exponential, capped at 60 s, with jitter.
- Session sort order everywhere: `needs_input`, `finished`, `working`, `idle`, `ended`; ties by `lastActivityAt` descending.
- Themes: Graphite, Ember, Aurora, Phosphor (each light + dark) and Dynamic on API 31+. Colour tokens are the CSS variables in `docs/design/mockups/03-tabs-themes-features.html`, reproduced in Task 6.
- Termux code keeps its Apache-2.0 header and a NOTICE; every local change is listed in `android/terminal-emulator/AFK-CHANGES.md` / `android/terminal-view/AFK-CHANGES.md`.
- Files stay small and single-purpose; ktlint passes in CI; no `!!` on protocol data.
- Every destructive action (kill, unpair) confirms. The app never auto-answers a pending prompt.

## Review Focus

1. **Unknown message type from a newer daemon** → decoded as `ServerMessage.Unknown` and ignored, never an exception that kills the socket. Test in Task 2.
2. **Socket drops while a terminal is open** → on reconnect the bridge re-sends `pty.subscribe`, clears the emulator, and applies the fresh `pty.snapshot`; stale bytes are never appended. Test in Task 9.
3. **Notification action tapped after the prompt was already answered** → the daemon's `error not_found` becomes a toast "Already answered", the notification is dismissed, nothing crashes. Test in Task 8.
4. **Keyboard open / rotation / font-size pinch** → one `pty.resize` with the new grid after a 150 ms debounce, not one per layout pass. Test in Task 9.
5. **Search with regex metacharacters (`[`, `(`, `*`)** → literal, case-insensitive match on name, cwd, branch, last message. Test in Task 5.

---

### Task 1: Project scaffold and CI

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/libs.versions.toml`, `android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/*`
- Create: `android/app/build.gradle.kts`, `android/app/proguard-rules.pro`, `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/kotlin/io/github/amaankhan63/afk/AfkApp.kt`, `MainActivity.kt`
- Create: `android/app/src/test/kotlin/io/github/amaankhan63/afk/SmokeTest.kt`
- Create: `.github/workflows/android.yml`, `android/.editorconfig`
- Modify: `.gitignore` (already ignores `.gradle/`, `*/build/`, `local.properties`)

**Interfaces:**
- Produces: `@HiltAndroidApp class AfkApp : Application()`; `@AndroidEntryPoint class MainActivity : ComponentActivity()` showing a placeholder `Text("AFK")`; version catalog aliases used by every later task (`libs.compose.bom`, `libs.hilt.android`, `libs.kotlinx.serialization.json`, `libs.okhttp`, `libs.datastore.preferences`, `libs.navigation.compose`, `libs.turbine`, `libs.coroutines.test`, `libs.robolectric`, `libs.mockwebserver`, `libs.zxing.embedded`, `libs.core.splashscreen`).

- [ ] **Step 1: Write the failing test**

```kotlin
class SmokeTest {
    @Test fun applicationIdIsExpected() =
        assertEquals("io.github.amaankhan63.afk", BuildConfig.APPLICATION_ID)
}
```

- [ ] **Step 2: Run it to see it fail** — `cd android && ./gradlew :app:testDebugUnitTest` → fails: no project.

- [ ] **Step 3: Create the Gradle project** — Kotlin DSL, version catalog, plugins `com.android.application`, `org.jetbrains.kotlin.android`, `org.jetbrains.kotlin.plugin.compose`, `org.jetbrains.kotlin.plugin.serialization`, `com.google.devtools.ksp`, `com.google.dagger.hilt.android`, `org.jlleitschuh.gradle.ktlint`. `buildConfig = true`, `compose = true`, `minSdk 26`. Add `maven("https://jitpack.io")` to repositories (used later). `AfkApp` and `MainActivity` as in Interfaces.

- [ ] **Step 4: Run the test** — `./gradlew :app:testDebugUnitTest :app:ktlintCheck` → PASS.

- [ ] **Step 5: CI** — `.github/workflows/android.yml`: on push/PR touching `android/**` or `protocol/**`; `ubuntu-latest`; JDK 17 (temurin); `gradle/actions/setup-gradle`; run `./gradlew :app:ktlintCheck :app:testDebugUnitTest :app:assembleDebug` from `android/`; upload `app-debug.apk` as an artifact.

- [ ] **Step 6: Commit** — `git add android .github/workflows/android.yml && git commit -m "android: scaffold Compose app with Hilt, CI"`

---

### Task 2: Protocol models

**Files:**
- Create: `app/src/main/kotlin/io/github/amaankhan63/afk/data/protocol/Models.kt`, `Messages.kt`, `AfkJson.kt`
- Test: `app/src/test/kotlin/io/github/amaankhan63/afk/data/protocol/MessagesTest.kt`, `ProtocolExamplesTest.kt`

**Interfaces:**
- Produces (all `@Serializable`, field names exactly as `protocol/protocol.md`):
  - `enum class SessionKind { shell, claude, codex }`, `enum class SessionState { idle, working, needs_input, finished, ended }` (serial names lowercase as written).
  - `data class Session(id, name, cwd, kind, state, createdAt, lastActivityAt, endedAt: String? = null, exitCode: Int? = null, gitBranch: String? = null, agentSessionId: String? = null, lastMessage: String? = null, subagentsRunning: Int = 0, pending: Pending? = null)`.
  - `sealed interface Pending` with `@SerialName("question") data class Question(id, text, multiSelect: Boolean, allowsText: Boolean, options: List<Option>)`, `data class Option(label, description: String? = null, recommended: Boolean = false)`, `@SerialName("permission") data class Permission(id, tool, summary)`; discriminator `kind`.
  - `data class ChatEvent(id, threadId, at, kind: ChatKind, text: String? = null, tool: ToolInfo? = null, subagent: SubagentInfo? = null, pending: Pending? = null, turn: TurnInfo? = null)` with `enum class ChatKind { user, assistant, tool, subagent, question, permission, turn }`, `enum class ToolStatus { running, ok, error }`, `enum class SubagentStatus { running, done, error }`, `ToolInfo(name, summary, status: ToolStatus, input: String? = null, result: String? = null)`, `SubagentInfo(threadId, name, task, status: SubagentStatus, toolUses: Int)`, `TurnInfo(phase: String)`.
  - `data class ClientInfo(kind: String, name: String)`, `data class DirEntry(name: String, path: String)`, `data class DaemonSettingsPatch(keepAwake: Boolean? = null, keepAwakeGraceMin: Int? = null, retentionHours: Int? = null)` (the wire form of `Partial<DaemonSettings>`), and `class AfkError(val code: String, message: String) : Exception(message)` used by every `Result.failure` in the repository.
  - `data class Strip(at, model: ModelInfo? = null, thinking: String? = null, contextUsedPct: Double? = null, contextSize: Long? = null, costUsd: Double? = null, durationMs: Long? = null, fiveHourPct: Double? = null, sevenDayPct: Double? = null, tokensIn: Long? = null, tokensOut: Long? = null)`, `ModelInfo(id, name)`.
  - `data class Stats(at, ramUsedBytes: Long, ramTotalBytes: Long, cpuPercent: Double, keepAwakeActive: Boolean)`, `data class DaemonSettings(keepAwake: Boolean = true, keepAwakeGraceMin: Int = 10, retentionHours: Int = 24)`.
  - `sealed interface ServerMessage` with one `@SerialName` subclass per daemon→client type in protocol.md (`Hello`, `Ack(id, sessionId: String? = null)`, `Error(id: String? = null, code, message)`, `SessionsSnapshot`, `SessionUpdated`, `SessionRemoved`, `StatsMsg`, `DaemonSettingsMsg(id: String? = null, settings)`, `PtySnapshot(sessionId, cols, rows, data)`, `PtyData(sessionId, data)`, `PtyResized`, `ChatSnapshot`, `ChatEventMsg`, `StripUpdate`, `Notify(event, sessionId, sessionName, title, body, pending: Pending? = null)`, `FsDirs(id, path: String? = null, parent: String? = null, dirs: List<DirEntry>, recent: List<String>)`) plus `Unknown(type: String)`.
  - `sealed interface ClientMessage` with one subclass per client→daemon type (`Auth(token, protocol: Int = 1, client: ClientInfo)`, `SessionCreate(id, cwd, kind, args: List<String>, name: String? = null, prompt: String? = null)`, `SessionKill(id, sessionId)`, `SessionResume`, `SessionRename`, `PtySubscribe(id, sessionId, cols, rows)`, `PtyUnsubscribe(sessionId)`, `PtyInput(sessionId, data)`, `PtyResize(sessionId, cols, rows)`, `ChatSubscribe(id, sessionId, threadId: String = "main")`, `ChatUnsubscribe`, `PendingAnswer(id, sessionId, pendingId, choiceIndices: List<Int>? = null, text: String? = null, decision: String? = null)`, `FsListDirs(id, path: String? = null)`, `DaemonSettingsGet(id)`, `DaemonSettingsSet(id, settings: DaemonSettingsPatch)`).
  - `object AfkJson { val json: Json }` with `ignoreUnknownKeys = true`, `classDiscriminator = "type"`, `encodeDefaults = true`, `explicitNulls = false`; `fun decodeServer(text: String): ServerMessage` (reads `type` first; unknown → `Unknown`); `fun encodeClient(msg: ClientMessage): String`.

- [ ] **Step 1: Write the failing tests**

```kotlin
class MessagesTest {
    @Test fun decodesHello() {
        val m = AfkJson.decodeServer("""{"type":"hello","protocol":1,"daemon":{"version":"0.1.0","hostname":"AMAN-LAPTOP","platform":"win32"},"device":{"id":"dev_1","name":"Pixel"}}""")
        assertEquals("AMAN-LAPTOP", (m as ServerMessage.Hello).daemon.hostname)
    }
    @Test fun decodesSessionUpdatedWithQuestion() {
        val m = AfkJson.decodeServer("""{"type":"session.updated","session":{"id":"s_1","name":"x","cwd":"D:\\x","kind":"claude","state":"needs_input","createdAt":"2026-10-30T10:00:00Z","lastActivityAt":"2026-10-30T10:01:00Z","subagentsRunning":0,"pending":{"kind":"question","id":"q1","text":"Which?","multiSelect":false,"allowsText":true,"options":[{"label":"A","recommended":true},{"label":"B"}]}}}""") as ServerMessage.SessionUpdated
        val q = m.session.pending as Pending.Question
        assertTrue(q.options[0].recommended); assertEquals(SessionState.needs_input, m.session.state)
    }
    @Test fun unknownTypeDecodesAsUnknown() =
        assertEquals(ServerMessage.Unknown("pty.hologram"), AfkJson.decodeServer("""{"type":"pty.hologram","x":1}"""))
    @Test fun ignoresUnknownFields() { AfkJson.decodeServer("""{"type":"session.removed","sessionId":"s_1","extra":true}""") }
    @Test fun encodesAuthWithDiscriminatorFirst() {
        val s = AfkJson.encodeClient(ClientMessage.Auth(token = "t", client = ClientInfo("android", "Pixel 8")))
        assertTrue(s.startsWith("""{"type":"auth""")); assertTrue(s.contains(""""protocol":1"""))
    }
    @Test fun pendingAnswerOmitsNulls() =
        assertFalse(AfkJson.encodeClient(ClientMessage.PendingAnswer("r1", "s_1", "q1", choiceIndices = listOf(0))).contains("null"))
}
class ProtocolExamplesTest {
    private val serverTypes = setOf("hello","ack","error","sessions.snapshot","session.updated","session.removed","stats","daemon.settings","pty.snapshot","pty.data","pty.resized","chat.snapshot","chat.event","strip.update","notify","fs.dirs")
    @Test fun everyExampleParses() {
        val dir = File("../../protocol/examples"); assumeTrue(dir.isDirectory)
        dir.listFiles { f -> f.extension == "json" }!!.forEach { f ->
            val type = Json.parseToJsonElement(f.readText()).jsonObject["type"]!!.jsonPrimitive.content
            if (type in serverTypes) assertFalse(f.name, AfkJson.decodeServer(f.readText()) is ServerMessage.Unknown)
            else AfkJson.json.decodeFromString<ClientMessage>(f.readText())
        }
    }
}
```

- [ ] **Step 2: Run to see them fail** — `./gradlew :app:testDebugUnitTest --tests '*protocol*'` → compilation errors.

- [ ] **Step 3: Implement `Models.kt`, `Messages.kt`, `AfkJson.kt`** — `decodeServer` uses a `JsonContentPolymorphicSerializer<ServerMessage>` that maps `type` to the subclass and falls back to `Unknown`. `Pending` uses `classDiscriminator = "kind"` via `@JsonClassDiscriminator("kind")`.

- [ ] **Step 4: Run tests** — same command → PASS (examples test is skipped until the service plan generates files; it must pass once they exist).

- [ ] **Step 5: Commit** — `git commit -am "android: protocol models mirroring protocol v1"`

---

### Task 3: Connection layer

**Files:**
- Create: `data/connection/Endpoint.kt`, `AfkSocket.kt`, `Backoff.kt`, `ConnectionState.kt`, `ConnectionManager.kt`
- Test: `data/connection/BackoffTest.kt`, `AfkSocketTest.kt`, `ConnectionManagerTest.kt`

**Interfaces:**
- Consumes: Task 2 models.
- Produces:
  - `data class Endpoint(val host: String, val port: Int = 2350) { fun wsUrl(): String = "ws://$host:$port/ws" }`
  - `class Backoff(val baseMs: Long = 1_000, val capMs: Long = 60_000, private val random: Random = Random.Default) { fun delayMs(attempt: Int): Long }` — exponential `base * 2^attempt`, capped, jitter in `[0.5, 1.0] × value`.
  - `sealed interface ConnectionState { object Disconnected; data class Connecting(val attempt: Int); data class Connected(val hello: ServerMessage.Hello); data class Failed(val code: String) }`
  - `class AfkSocket(private val client: OkHttpClient) { val incoming: SharedFlow<ServerMessage>; val events: SharedFlow<SocketEvent>; fun open(endpoint: Endpoint, token: String, clientName: String); fun send(msg: ClientMessage): Boolean; fun close() }` with `sealed interface SocketEvent { Opened; Closed(code, reason); Failure(t) }`. `open` sends `Auth` as the first frame.
  - `class ConnectionManager(socket: AfkSocket, backoff: Backoff, scope: CoroutineScope, clientName: String) { val state: StateFlow<ConnectionState>; val incoming: SharedFlow<ServerMessage>; fun start(endpoint: Endpoint, token: String); fun stop(); suspend fun request(msg: ClientMessage, timeoutMs: Long = 10_000): ServerMessage; fun send(msg: ClientMessage) }` — `request` correlates on `id` and returns the `Ack`/`Error`/`FsDirs`/`DaemonSettingsMsg` carrying it. Stops reconnecting on `error.code` `unauthorized` or `protocol_mismatch` (→ `Failed`).

- [ ] **Step 1: Write the failing tests**

```kotlin
class BackoffTest {
    @Test fun firstDelayAtMostOneSecond() = assertTrue(Backoff(random = Random(1)).delayMs(0) in 500..1000)
    @Test fun neverExceedsCap() = (0..20).forEach { assertTrue(Backoff(random = Random(it)).delayMs(it) <= 60_000) }
    @Test fun growsExponentially() = assertTrue(Backoff(random = Random(7)).delayMs(5) > Backoff(random = Random(7)).delayMs(1))
}
class AfkSocketTest { // MockWebServer with a WebSocket listener
    @Test fun sendsAuthAsFirstFrame() { /* open; assert first server-received text decodes to Auth with token "tok", protocol 1 */ }
    @Test fun emitsDecodedIncoming() { /* server sends hello JSON; incoming.first() is Hello */ }
}
class ConnectionManagerTest {
    @Test fun becomesConnectedOnHello() = runTest { /* state goes Connecting(0) → Connected */ }
    @Test fun reconnectsAfterServerClose() = runTest { /* server closes after hello; state passes Connecting(1); backoff delay from test scheduler */ }
    @Test fun stopsOnUnauthorized() = runTest { /* server sends error unauthorized; state is Failed("unauthorized"); no further connection attempts */ }
    @Test fun requestResolvesAckById() = runTest { /* send SessionKill("r1"); server replies ack id r1; request returns Ack */ }
    @Test fun requestTimesOut() = runTest { /* no reply → throws TimeoutCancellationException */ }
}
```

- [ ] **Step 2: Run** — `./gradlew :app:testDebugUnitTest --tests '*connection*'` → FAIL (unresolved).

- [ ] **Step 3: Implement** the four classes. `ConnectionManager` loop: open → await `Hello` (or terminal `Error`) → on `Closed`/`Failure` wait `backoff.delayMs(attempt++)` → repeat; `attempt` resets on `Hello`. Pending requests are a `ConcurrentHashMap<String, CompletableDeferred<ServerMessage>>`; ids are `"r" + counter`.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "android: websocket connection with auth, backoff, request correlation"`

---

### Task 4: Pairing storage, QR payload, Pairing screen

**Files:**
- Create: `data/pairing/PairingPayload.kt`, `PairingStore.kt`; `ui/pairing/PairingScreen.kt`, `PairingViewModel.kt`; `di/DataStoreModule.kt`
- Test: `data/pairing/PairingPayloadTest.kt`, `PairingStoreTest.kt` (Robolectric), `ui/pairing/PairingViewModelTest.kt`

**Interfaces:**
- Consumes: `ConnectionManager` (Task 3).
- Produces:
  - `data class PairingPayload(val host: String, val port: Int = 2350, val token: String) { fun endpoint() = Endpoint(host, port) }`
  - `object PairingCodec { fun parse(raw: String): Result<PairingPayload> }` — accepts `{"afk":1,"host":…,"port":…,"token":…}`; `port` defaults to 2350; fails on `afk != 1`, blank host, blank token.
  - `class PairingStore(dataStore: DataStore<Preferences>) { val pairing: Flow<PairingPayload?>; suspend fun save(p: PairingPayload); suspend fun clear() }`
  - `data class PairingUiState(host: String = "", port: String = "2350", token: String = "", testing: Boolean = false, result: TestResult? = null)`; `sealed interface TestResult { data class Ok(hostname: String); data class Failed(reason: String) }`
  - `class PairingViewModel(store, connectionFactory: () -> ConnectionManager) { val ui: StateFlow<PairingUiState>; fun onScanned(raw: String); fun onEdit(host, port, token); fun testConnection(); fun save(onDone: () -> Unit) }`
  - `@Composable fun PairingScreen(onPaired: () -> Unit)` — Scan QR (zxing `ScanContract`), three fields, Test, Save (enabled after `Ok`).

- [ ] **Step 1: Write the failing tests**

```kotlin
class PairingPayloadTest {
    @Test fun parsesFullPayload() = assertEquals(PairingPayload("100.84.12.9", 2350, "abc"), PairingCodec.parse("""{"afk":1,"host":"100.84.12.9","port":2350,"token":"abc"}""").getOrThrow())
    @Test fun portDefaultsTo2350() = assertEquals(2350, PairingCodec.parse("""{"afk":1,"host":"h","token":"t"}""").getOrThrow().port)
    @Test fun rejectsWrongVersion() = assertTrue(PairingCodec.parse("""{"afk":2,"host":"h","token":"t"}""").isFailure)
    @Test fun rejectsBlankToken() = assertTrue(PairingCodec.parse("""{"afk":1,"host":"h","token":""}""").isFailure)
}
class PairingStoreTest { @Test fun roundTrips() = runTest { /* save then pairing.first() equals */ } ; @Test fun clearYieldsNull() = runTest { } }
class PairingViewModelTest {
    @Test fun scanFillsFields() { /* onScanned(valid) → ui.host/port/token set */ }
    @Test fun testConnectionReportsHostname() = runTest { /* fake manager emits Connected(hello) → result Ok("AMAN-LAPTOP") */ }
    @Test fun testConnectionReportsUnauthorized() = runTest { /* Failed("unauthorized") → TestResult.Failed */ }
}
```

- [ ] **Step 2: Run** — `./gradlew :app:testDebugUnitTest --tests '*pairing*'` → FAIL.

- [ ] **Step 3: Implement** codec, store (keys `host`, `port`, `token`), ViewModel (`testConnection` starts a temporary manager, awaits first `Connected`/`Failed` with 10 s timeout, then stops it), screen, and a Hilt module providing `DataStore<Preferences>` named `afk_prefs`.

- [ ] **Step 4: Run tests** → PASS. Manual: install debug build, scan a QR encoding the payload, see "Connected to <hostname>".

- [ ] **Step 5: Commit** — `git commit -am "android: pairing payload, store, and pairing screen"`

---

### Task 5: Sessions repository and reducers

**Files:**
- Create: `data/sessions/SessionsReducer.kt`, `SessionOrder.kt`, `SessionSearch.kt`, `SessionFilter.kt`, `SessionsRepository.kt`, `PtyFrame.kt`, `ChatUpdate.kt`; `di/RepositoryModule.kt`
- Test: `data/sessions/SessionsReducerTest.kt`, `SessionOrderTest.kt`, `SessionSearchTest.kt`, `SessionsRepositoryTest.kt`

**Interfaces:**
- Consumes: `ConnectionManager.incoming`, `.state`, `.send`, `.request` (Task 3).
- Produces:
  - `object SessionsReducer { fun reduce(current: Map<String, Session>, msg: ServerMessage): Map<String, Session> }` — handles `SessionsSnapshot` (replace), `SessionUpdated` (upsert), `SessionRemoved` (drop); other messages return `current`.
  - `object SessionOrder { val rank: Map<SessionState, Int> = mapOf(needs_input to 0, finished to 1, working to 2, idle to 3, ended to 4); fun sorted(list: List<Session>): List<Session> }`
  - `object SessionSearch { fun matches(s: Session, query: String): Boolean }` — literal, case-insensitive, over `name`, `cwd`, `gitBranch`, `lastMessage`; blank query matches all.
  - `enum class StateFilter { All, NeedsYou, Working, Done }`; `data class SessionFilter(val state: StateFilter = StateFilter.All, val agents: Set<SessionKind> = emptySet()) { fun accepts(s: Session): Boolean }` — `NeedsYou` = `needs_input`; `Working` = `working`; `Done` = `finished` or `ended`; empty `agents` = all.
  - `sealed interface PtyFrame { data class Snapshot(cols: Int, rows: Int, bytes: ByteArray); data class Data(bytes: ByteArray); data class Resized(cols: Int, rows: Int) }`
  - `sealed interface ChatUpdate { data class Snapshot(events: List<ChatEvent>); data class Event(event: ChatEvent) }`
  - `class SessionsRepository(manager: ConnectionManager, scope: CoroutineScope) { val connection: StateFlow<ConnectionState>; val sessions: StateFlow<List<Session>>; val stats: StateFlow<Stats?>; val daemonSettings: StateFlow<DaemonSettings?>; val notifications: SharedFlow<ServerMessage.Notify>; fun session(id: String): Flow<Session?>; fun strip(id: String): StateFlow<Strip?>; fun pty(id: String, cols: Int, rows: Int): Flow<PtyFrame>; fun chat(id: String, threadId: String = "main"): Flow<ChatUpdate>; fun ptyInput(id: String, bytes: ByteArray); fun ptyResize(id: String, cols: Int, rows: Int); suspend fun createSession(cwd: String, kind: SessionKind, args: List<String>, name: String?, prompt: String?): Result<String>; suspend fun killSession(id: String): Result<Unit>; suspend fun resumeSession(id: String): Result<String>; suspend fun renameSession(id: String, name: String): Result<Unit>; suspend fun answerPending(id: String, pendingId: String, choices: List<Int>? = null, text: String? = null, decision: String? = null): Result<Unit>; suspend fun listDirs(path: String?): Result<ServerMessage.FsDirs>; suspend fun setDaemonSettings(patch: DaemonSettingsPatch): Result<DaemonSettings> }`. `pty(...)` sends `PtySubscribe` on collection start, `PtyUnsubscribe` on cancel, base64-decodes `data`, and **re-subscribes automatically when `connection` returns to `Connected`**. `Result.failure` carries `AfkError(code, message)` from `ServerMessage.Error`.

- [ ] **Step 1: Write the failing tests**

```kotlin
class SessionOrderTest {
    @Test fun needsInputFirstThenFinishedWorkingIdleEnded() {
        val states = listOf(SessionState.ended, SessionState.idle, SessionState.working, SessionState.finished, SessionState.needs_input)
        val sorted = SessionOrder.sorted(states.mapIndexed { i, st -> session("s$i", state = st, lastActivityAt = "2026-10-30T10:00:0${i}Z") })
        assertEquals(listOf(needs_input, finished, working, idle, ended), sorted.map { it.state })
    }
    @Test fun tiesByLastActivityDescending() { /* two idle sessions; newer first */ }
}
class SessionSearchTest {
    @Test fun matchesBranchCaseInsensitively() = assertTrue(SessionSearch.matches(session(gitBranch = "feature/CI"), "ci"))
    @Test fun regexMetacharactersAreLiteral() { assertFalse(SessionSearch.matches(session(name = "abc"), "[")); assertTrue(SessionSearch.matches(session(lastMessage = "ran f(x)"), "f(x)")) }
    @Test fun blankMatchesAll() = assertTrue(SessionSearch.matches(session(), "   "))
}
class SessionsReducerTest {
    @Test fun snapshotReplaces() { }; @Test fun updatedUpserts() { }; @Test fun removedDrops() { }; @Test fun unrelatedMessageIsNoOp() { }
}
class SessionsRepositoryTest { // fake ConnectionManager backed by MutableSharedFlow
    @Test fun ptySubscribeSendsSubscribeAndDecodesBase64() = runTest { /* collect pty("s_1", 80, 24); assert PtySubscribe(cols=80, rows=24) sent; emit PtySnapshot data "aGk=" → Snapshot bytes "hi" */ }
    @Test fun ptyResubscribesOnReconnect() = runTest { /* state Connected→Connecting→Connected; two PtySubscribe sent */ }
    @Test fun killMapsErrorToFailure() = runTest { /* reply error not_found → Result.failure with code not_found */ }
    @Test fun notificationsForwarded() = runTest { /* incoming Notify → notifications.first() */ }
    @Test fun filterDoneIncludesFinishedAndEnded() { /* SessionFilter(Done) accepts both */ }
}
```

- [ ] **Step 2: Run** — `./gradlew :app:testDebugUnitTest --tests '*sessions*'` → FAIL.

- [ ] **Step 3: Implement** the files. Base64 via `android.util.Base64` wrapped in a tiny `Base64Codec` object so unit tests run on JVM (use `java.util.Base64` underneath).

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "android: sessions repository, ordering, search, filters"`

---

### Task 6: Theme system

**Files:**
- Create: `ui/theme/AfkTheme.kt` (enums), `AfkPalette.kt`, `Palettes.kt` (tokens), `TerminalColors.kt`, `Theme.kt` (composable), `Type.kt`, `Shapes.kt`
- Test: `ui/theme/PalettesTest.kt`

**Interfaces:**
- Produces:
  - `enum class AfkThemeId { Graphite, Ember, Aurora, Phosphor, Dynamic }`, `enum class ThemeMode { System, Light, Dark }`
  - `data class AfkPalette(bg, surface, surface2, border, text, text2, accent, onAccent, accentSoft, amber, blue, green, claude, codex, shell: Color, accentGradient: List<Color>? = null)`
  - `data class TerminalColors(background: Color, foreground: Color, cursor: Color, ansi16: List<Color>)`
  - `object Palettes { fun palette(id: AfkThemeId, dark: Boolean): AfkPalette; fun terminal(id: AfkThemeId, dark: Boolean): TerminalColors; fun resolvesDynamic(id: AfkThemeId, sdk: Int): AfkThemeId }` — `Dynamic` below API 31 resolves to `Graphite`.
  - `val LocalAfkPalette: ProvidableCompositionLocal<AfkPalette>`; `@Composable fun AfkTheme(id: AfkThemeId, mode: ThemeMode, content: @Composable () -> Unit)` — maps the palette onto `MaterialTheme.colorScheme` (`primary=accent`, `onPrimary=onAccent`, `background=bg`, `surface=surface`, `surfaceVariant=surface2`, `outline=border`, `onSurface=text`, `onSurfaceVariant=text2`, `primaryContainer=accentSoft`, `onPrimaryContainer=accent`), uses `dynamicDarkColorScheme`/`dynamicLightColorScheme` for Dynamic, monospace `Typography` and `Shapes(small=4.dp, medium=7.dp, large=7.dp)` for Phosphor, otherwise sans and `12/14/16.dp`.

Tokens (dark / light), copied from the mockup CSS:

| Theme | bg | surface | surface2 | border | text | text2 | accent | onAccent | accentSoft | amber | blue | green | claude | codex | shell | term bg | term fg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Graphite dark | 0b0d12 | 12151c | 1a1e27 | 222733 | e6e8ee | 8f96a3 | 9cc4ff | 0b1a33 | 1d2a44 | f5b94a | 5aa9ff | 4fd38a | e3a57e | b4a7ff | 7fd1e6 | 0b0d12 | d4d8e0 |
| Graphite light | f2f3f6 | ffffff | e9ebf0 | dcdfe6 | 171a21 | 697180 | 2f6fed | ffffff | e3ecff | c98a12 | 2f6fed | 1f9d5a | c2622f | 6a52e6 | 1686a3 | ffffff | 2a2f3a |
| Ember dark | 120f0d | 1b1613 | 241e1a | 2e2622 | f3ebe3 | a3978c | e8a06c | 2a160a | 3a2718 | f2b955 | 8fb7ff | 6fd39a | f0b48c | c5b4ff | 86d0c0 | 120f0d | e9dfd4 |
| Ember light | f8f3ec | fffdf9 | f1e9df | e3d8cb | 2a211b | 7d6f63 | c8622f | ffffff | f6e2d5 | b8800f | 3a6fd8 | 1f8f5a | bf5a2a | 6c54d8 | 1a8f7f | fffdf9 | 332a24 |
| Aurora dark | 0a0c18 | 11142a | 181c38 | 232848 | e9ebff | 8f94bb | 8ef0d6 | 062219 | 1a2f3a | ffc46b | 86a9ff | 5fe0a8 | ffb088 | b9a6ff | 7ad8ff | 0a0c18 | d9dcf5 |
| Aurora light | f0f2fb | ffffff | e7eaf8 | d8dcf0 | 171a33 | 6b7096 | 4f46e5 | ffffff | e6e4ff | c58a0d | 4f46e5 | 179c62 | d2652f | 6d5ae6 | 0e8fb8 | ffffff | 2a2d4a |
| Phosphor dark | 040705 | 0a120c | 0f1a12 | 15261a | d8f3df | 6f9c7c | 3dff8f | 04200f | 0f3a20 | ffd166 | 62b6ff | 3dff8f | ffb86b | c3a6ff | 62e0ff | 040705 | c8eccf |
| Phosphor light | eef3ee | ffffff | e2ebe3 | cfdcd2 | 10251a | 577462 | 0f9d58 | ffffff | d9f1e3 | b07a00 | 1f6fd0 | 0f9d58 | cc6b1f | 6f4fd9 | 0c8fb0 | ffffff | 1d3326 |

Aurora `accentGradient`: dark `b9a6ff → 8ef0d6`, light `6d5ae6 → 1fb597`. Terminal `ansi16` per theme: builder derives a 16-colour set from the palette (black=bg, red=amber-ish/error, green=green, yellow=amber, blue=blue, magenta=codex, cyan=shell, white=text, bright = lightened), cursor = accent.

- [ ] **Step 1: Write the failing tests**

```kotlin
class PalettesTest {
    @Test fun graphiteDarkAccentMatchesMockup() = assertEquals(Color(0xFF9CC4FF), Palettes.palette(AfkThemeId.Graphite, dark = true).accent)
    @Test fun emberLightBackgroundMatchesMockup() = assertEquals(Color(0xFFF8F3EC), Palettes.palette(AfkThemeId.Ember, dark = false).bg)
    @Test fun auroraHasGradient() = assertEquals(listOf(Color(0xFFB9A6FF), Color(0xFF8EF0D6)), Palettes.palette(AfkThemeId.Aurora, true).accentGradient)
    @Test fun phosphorTerminalIsNearBlack() = assertEquals(Color(0xFF040705), Palettes.terminal(AfkThemeId.Phosphor, true).background)
    @Test fun every16ColourTableHas16() = AfkThemeId.entries.filter { it != AfkThemeId.Dynamic }.forEach { id -> listOf(true, false).forEach { assertEquals(16, Palettes.terminal(id, it).ansi16.size) } }
    @Test fun dynamicFallsBackBelow31() = assertEquals(AfkThemeId.Graphite, Palettes.resolvesDynamic(AfkThemeId.Dynamic, sdk = 30))
}
```

- [ ] **Step 2: Run** — `./gradlew :app:testDebugUnitTest --tests '*theme*'` → FAIL.

- [ ] **Step 3: Implement** the files with the token table above.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "android: four themes with light/dark, dynamic colour, terminal palettes"`

---

### Task 7: Sessions screen

**Files:**
- Create: `ui/sessions/SessionsViewModel.kt`, `SessionsScreen.kt`, `LaptopStrip.kt`, `FilterChipsRow.kt`, `SessionCard.kt`, `ui/components/StateDot.kt`, `ui/components/AgentTag.kt`, `ui/util/RelativeTime.kt`, `ui/util/Bytes.kt`
- Test: `ui/sessions/SessionsViewModelTest.kt`, `ui/util/RelativeTimeTest.kt`, `ui/util/BytesTest.kt`; androidTest: `ui/sessions/SessionsScreenTest.kt`

**Interfaces:**
- Consumes: `SessionsRepository` (Task 5), `Palettes`/`LocalAfkPalette` (Task 6).
- Produces:
  - `data class SessionsUiState(val sessions: List<Session> = emptyList(), val query: String = "", val filter: SessionFilter = SessionFilter(), val counts: Map<StateFilter, Int> = emptyMap(), val stats: Stats? = null, val hostname: String? = null, val connection: ConnectionState = ConnectionState.Disconnected)`
  - `class SessionsViewModel(repo) : ViewModel() { val ui: StateFlow<SessionsUiState>; fun onQuery(q: String); fun onFilter(f: SessionFilter); fun kill(id: String); fun rename(id: String, name: String); fun resume(id: String) }` — `sessions` is filtered, searched, then `SessionOrder.sorted`.
  - `@Composable fun SessionsScreen(onOpen: (String) -> Unit, onNew: () -> Unit, onSettings: () -> Unit)` plus a stateless overload `SessionsScreen(state: SessionsUiState, onOpen, onNew, onSettings, onQuery: (String) -> Unit, onFilter: (SessionFilter) -> Unit)`; the card list is a `LazyColumn` with `Modifier.testTag("session-list")`; `LaptopStrip(hostname, stats, connection)` — RAM bar amber when `ramUsed/ramTotal ≥ 0.85`; `SessionCard(session, onClick, onLongClick)` with `Modifier.testTag("session-${session.id}")`, agent colour on the left edge and tag (`claude`→`palette.claude`, `codex`→`palette.codex`, `shell`→`palette.shell`), state dot + label text (`Needs your input` / `Finished` / `Finished · asked you something` when `lastMessage` ends with `?` / `Working · <duration>` / `Shell · idle` / `Ended`), one monospace line of `lastMessage`, tags for sub-agent count (if > 0) and branch. Long-press sheet: Rename, Kill (confirm), Resume (only `ended` with `agentSessionId`).
  - `fun relativeTime(iso: String, now: Instant): String` → `now`, `2m`, `1h`, `3d`; `fun humanBytes(bytes: Long): String` → `12.6 GB`.

- [ ] **Step 1: Write the failing tests**

```kotlin
class SessionsViewModelTest {
    @Test fun appliesSearchFilterAndOrder() = runTest { /* repo with 4 sessions (needs_input codex, working claude, idle shell "ToolKit", ended claude); query "" filter agents={claude} → two claude sessions, working before ended */ }
    @Test fun countsReflectUnfilteredSessions() = runTest { /* counts[NeedsYou]==1 even when filter is Working */ }
}
class RelativeTimeTest { @Test fun twoMinutes() = assertEquals("2m", relativeTime("2026-10-30T10:00:00Z", Instant.parse("2026-10-30T10:02:10Z"))) ; @Test fun underAMinuteIsNow() { } }
class BytesTest { @Test fun gigabytesOneDecimal() = assertEquals("12.6 GB", humanBytes(13_529_146_982)) }
// androidTest
class SessionsScreenTest {
    @get:Rule val rule = createComposeRule()
    @Test fun needsInputCardIsRenderedFirstAndFabPresent() {
        rule.setContent { AfkTheme(AfkThemeId.Graphite, ThemeMode.Dark) { SessionsScreen(state = sampleState(), onOpen = {}, onNew = {}, onSettings = {}, onQuery = {}, onFilter = {}) } }
        rule.onNodeWithTag("session-list").onChildren().onFirst().assert(hasTestTag("session-s_needs"))
        rule.onNodeWithText("New session").assertIsDisplayed()
    }
}
```

- [ ] **Step 2: Run** — unit: `./gradlew :app:testDebugUnitTest --tests '*sessions*' --tests '*util*'`; UI: `./gradlew :app:connectedDebugAndroidTest` (emulator) → FAIL.

- [ ] **Step 3: Implement** — a stateless `SessionsScreen(state, callbacks…)` overload for tests plus the ViewModel-backed wrapper. Search field above two `LazyRow`s of chips (state group, then agent group, separated by a thin divider). `LazyColumn` of cards. FAB `＋ New session`.

- [ ] **Step 4: Run tests** → PASS. Visual check against `docs/design/mockups/02-home-and-themes.html` in all four themes.

- [ ] **Step 5: Commit** — `git commit -am "android: sessions home screen with laptop strip, search, filters"`

---

### Task 8: Foreground service and notifications

**Files:**
- Create: `service/NotificationChannels.kt`, `SessionNotifier.kt`, `NotificationActions.kt`, `NotificationActionReceiver.kt`, `ForegroundTracker.kt`, `AfkConnectionService.kt`, `data/settings/NotificationPrefs.kt`
- Modify: `AndroidManifest.xml` (service with `android:foregroundServiceType="connectedDevice"`, receiver, permissions `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS`, `INTERNET`), `MainActivity.kt` (request `POST_NOTIFICATIONS` on API 33+, start service when paired)
- Test: `service/SessionNotifierTest.kt` (Robolectric), `service/NotificationActionReceiverTest.kt`

**Interfaces:**
- Consumes: `SessionsRepository.notifications`, `.answerPending`, `.ptyInput` (Task 5); `ConnectionManager` (Task 3); `PairingStore` (Task 4).
- Produces:
  - `object NotificationChannels { const val NEEDS_INPUT = "needs_input"; const val FINISHED = "finished"; const val SUBAGENTS = "subagents"; const val CONNECTION = "connection"; fun ensure(context: Context) }`
  - `data class NotificationPrefs(val needsInput: Boolean = true, val finished: Boolean = true, val subagents: Boolean = false)` (stored in `AppSettingsStore`, Task 14; until then a default instance).
  - `object ForegroundTracker { val foregroundSessionId: StateFlow<String?>; fun set(id: String?) }`
  - `object NotificationActions { const val ACTION_CHOICE = "io.github.amaankhan63.afk.CHOICE"; const val ACTION_DECISION = "…DECISION"; const val ACTION_REPLY = "…REPLY"; const val EXTRA_SESSION = "session"; const val EXTRA_PENDING = "pending"; const val EXTRA_INDEX = "index"; const val EXTRA_DECISION = "decision"; const val REMOTE_INPUT_KEY = "afk_reply"; fun notificationId(sessionId: String): Int = sessionId.hashCode() and 0x7fffffff }`
  - `class SessionNotifier(context, prefsProvider: () -> NotificationPrefs) { fun build(n: ServerMessage.Notify): Notification? }` — returns `null` when the channel is disabled or `ForegroundTracker.foregroundSessionId == n.sessionId`; channel by `event` (`needs_input`→NEEDS_INPUT, `finished`→FINISHED, `subagent_finished`→SUBAGENTS); content intent deep link `afk://session/<id>`; actions: `Pending.Question` → up to 3 choice actions (labels) + Reply (RemoteInput) + Open; `Pending.Permission` → Allow, Deny, Open; `finished` → Reply + Open.
  - `class NotificationActionReceiver : BroadcastReceiver()` — Hilt entry point to `SessionsRepository`; `CHOICE` → `answerPending(choices=[index])`; `DECISION` → `answerPending(decision=…)`; `REPLY` → `ptyInput(text + "\r")`; on `Result.failure(not_found)` show toast "Already answered"; always cancels the notification.
  - `class AfkConnectionService : Service()` — `startForeground` with the CONNECTION-channel notification "Connected to <hostname>" (or "Connecting…"), starts `ConnectionManager` with the stored pairing, collects `notifications` → `NotificationManagerCompat.notify(notificationId, build(...))`; stops when unpaired. Companion `fun start(context)`, `fun stop(context)`.

- [ ] **Step 1: Write the failing tests**

```kotlin
@RunWith(RobolectricTestRunner::class)
class SessionNotifierTest {
    @Test fun questionHasThreeChoicesReplyAndOpen() { val n = notifier().build(notify(pending = question(options = 4)))!!; assertEquals(5, n.actions.size); assertEquals(NotificationChannels.NEEDS_INPUT, n.channelId) }
    @Test fun permissionHasAllowDenyOpen() { assertEquals(listOf("Allow","Deny","Open"), notifier().build(notify(pending = permission()))!!.actions.map { it.title.toString() }) }
    @Test fun finishedUsesDefaultChannelAndReply() { val n = notifier().build(notify(event = "finished"))!!; assertEquals(NotificationChannels.FINISHED, n.channelId); assertNotNull(n.actions.first { it.title == "Reply" }.remoteInputs) }
    @Test fun subagentSuppressedByDefault() = assertNull(notifier().build(notify(event = "subagent_finished")))
    @Test fun suppressedWhenSessionInForeground() { ForegroundTracker.set("s_1"); assertNull(notifier().build(notify(sessionId = "s_1"))); ForegroundTracker.set(null) }
    @Test fun idIsStablePerSession() = assertEquals(NotificationActions.notificationId("s_1"), NotificationActions.notificationId("s_1"))
}
@RunWith(RobolectricTestRunner::class)
class NotificationActionReceiverTest {
    @Test fun choiceSendsPendingAnswerWithIndex() { /* fake repo records answerPending("s_1","q1",choices=[2]) */ }
    @Test fun notFoundShowsAlreadyAnsweredToast() { /* fake repo returns failure(AfkError("not_found")); ShadowToast.getTextOfLatestToast() == "Already answered" */ }
    @Test fun replyWritesTextPlusCarriageReturn() { /* RemoteInput bundle "yes" → ptyInput bytes "yes\r" */ }
}
```

- [ ] **Step 2: Run** — `./gradlew :app:testDebugUnitTest --tests '*service*'` → FAIL.

- [ ] **Step 3: Implement** the files and manifest entries. Service is started from `MainActivity` when `PairingStore.pairing` is non-null and from `BOOT_COMPLETED` (receiver, permission `RECEIVE_BOOT_COMPLETED`).

- [ ] **Step 4: Run tests** → PASS. Manual on the phone: background the app, have the daemon emit a `notify`, confirm the notification, actions, and inline reply.

- [ ] **Step 5: Commit** — `git commit -am "android: foreground connection service and session notifications"`

---

### Task 9: Terminal: vendored Termux emulator and the terminal composable

**Files:**
- Create: `android/terminal-emulator/` and `android/terminal-view/` (vendored from `termux/termux-app` tag `v0.118.x`, with `LICENSE`, `NOTICE`, `AFK-CHANGES.md` each), add both to `settings.gradle.kts`
- Create: `ui/session/terminal/AfkTerminalSession.kt`, `TerminalBridge.kt`, `TerminalHost.kt` (AndroidView composable), `TerminalKeys.kt`
- Test: `ui/session/terminal/TerminalBridgeTest.kt`, `TerminalKeysTest.kt`

**Interfaces:**
- Consumes: `SessionsRepository.pty/ptyInput/ptyResize` (Task 5), `Palettes.terminal` (Task 6).
- Produces:
  - `class AfkTerminalSession(client: TerminalSessionClient, private val onInput: (ByteArray) -> Unit, private val onResize: (cols: Int, rows: Int) -> Unit) : TerminalSession(…)` — overrides `initializeEmulator(cols, rows, cellW, cellH)` to construct a `TerminalEmulator(this, cols, rows, 2000, client)` **without** `JNI.createSubprocess`; `getEmulator()`; `write(byte[], off, len)` → `onInput`; `updateSize(cols, rows)` → emulator resize + `onResize`; `isRunning()` = true until `finish()`; `finishIfRunning()` no-op. `fun feed(bytes: ByteArray)` → `emulator.append(bytes, bytes.size)` then `client.onTextChanged`. `fun reset()` → `emulator.reset()`. If any overridden member is `private`/`final` in the vendored source, widen it in the vendored file and record it in `AFK-CHANGES.md`.
  - `class TerminalBridge(repo: SessionsRepository, sessionId: String, scope: CoroutineScope, debounceMs: Long = 150) { val session: AfkTerminalSession; fun attach(cols: Int, rows: Int); fun detach(); fun onSizeChanged(cols: Int, rows: Int) }` — `attach` collects `repo.pty(sessionId, cols, rows)`: `Snapshot` → `reset()` then `feed`; `Data` → `feed`; `Resized` → `updateSize` without echo. Input bytes → `repo.ptyInput`. Size changes are debounced and sent as one `ptyResize`.
  - `object TerminalKeys { val ESC = byteArrayOf(0x1b); val TAB = byteArrayOf(0x09); val ENTER = byteArrayOf(0x0d); val UP = "\u001b[A".toByteArray(); val DOWN = "\u001b[B"…; val RIGHT = "\u001b[C"…; val LEFT = "\u001b[D"…; fun ctrl(c: Char): ByteArray }` — `ctrl('c')` = `0x03`, `ctrl('[')` = `0x1b`.
  - `@Composable fun TerminalHost(bridge: TerminalBridge, colors: TerminalColors, fontSizeSp: Int, modifier: Modifier)` — `AndroidView` creating `TerminalView`, `attachSession(bridge.session)`, applies colours and font size, calls `bridge.onSizeChanged` from `TerminalView`'s size callback; pinch gesture adjusts `fontSizeSp` via callback `onFontSizeChange`.

- [ ] **Step 1: Vendor the modules** — copy `terminal-emulator/` and `terminal-view/` from the Termux tag into `android/`, strip their JNI build (`src/main/jni`, `externalNativeBuild`) from the emulator module's Gradle file, keep Java sources, add `AFK-CHANGES.md` listing removals. `./gradlew :terminal-emulator:assembleDebug :terminal-view:assembleDebug` must pass. (Fallback if the pure-Java build fails without JNI: keep `JNI.java` as a stub whose methods throw `UnsupportedOperationException`.)

- [ ] **Step 2: Write the failing tests**

```kotlin
class TerminalKeysTest { @Test fun ctrlC() = assertArrayEquals(byteArrayOf(0x03), TerminalKeys.ctrl('c')); @Test fun upIsCsiA() = assertEquals("\u001b[A", String(TerminalKeys.UP)) }
class TerminalBridgeTest { // fake repo with MutableSharedFlow<PtyFrame>
    @Test fun snapshotResetsThenFeeds() = runTest { /* emit Data("stale"), then Snapshot; screen text contains snapshot text and not "stale" */ }
    @Test fun inputBytesForwarded() = runTest { /* session.write("ls".toByteArray()) → repo.ptyInput called with "ls" */ }
    @Test fun resizeDebouncedToOne() = runTest { bridge.onSizeChanged(80, 24); advanceTimeBy(50); bridge.onSizeChanged(81, 24); advanceTimeBy(200); assertEquals(listOf(81 to 24), repo.resizes) }
    @Test fun reconnectResubscribes() = runTest { /* connection Connected→Connecting→Connected; repo.subscribeCount == 2 (via repo.pty re-collection) */ }
}
```

- [ ] **Step 3: Run** — `./gradlew :app:testDebugUnitTest --tests '*terminal*'` → FAIL.

- [ ] **Step 4: Implement** `AfkTerminalSession`, `TerminalBridge`, `TerminalKeys`, `TerminalHost`.

- [ ] **Step 5: Run tests** → PASS. Manual: open a daemon session running Claude Code on the phone; the screen matches the laptop; typing works; rotate → one resize.

- [ ] **Step 6: Commit** — `git add android/terminal-emulator android/terminal-view app && git commit -m "android: vendored Termux terminal fed from the daemon socket"`

---

### Task 10: Session screen shell (tabs, composer, status strip, key bar)

**Files:**
- Create: `ui/session/SessionViewModel.kt`, `SessionScreen.kt`, `SessionTopBar.kt`, `Composer.kt`, `StatusStrip.kt`, `StripChips.kt`, `KeyBar.kt`, `terminal/TerminalTab.kt`
- Test: `ui/session/SessionViewModelTest.kt`, `StripChipsTest.kt`, `KeyBarStateTest.kt`

**Interfaces:**
- Consumes: Tasks 5, 6, 9; `AppSettingsStore` strip chips (Task 14; until then defaults).
- Produces:
  - `enum class SessionTab { Terminal, Chat }`
  - `enum class StripChip { Model, Thinking, CtxUsed, CtxSize, Cost, FiveHour, SevenDay, SessionTime, Memory, TokensInOut }`; `val DEFAULT_STRIP_CHIPS = listOf(Model, Thinking, CtxUsed, Cost, FiveHour, SessionTime)`
  - `object StripChips { fun render(chip: StripChip, strip: Strip?, stats: Stats?): String? }` — `Model`→`"✦ ${model.name}"`, `Thinking`→thinking, `CtxUsed`→`"ctx 11%"`, `CtxSize`→`"109.5k ctx"`, `Cost`→`"$3.60"`, `FiveHour`→`"5h 38%"`, `SevenDay`→`"7d 12%"`, `SessionTime`→`"32m"` from `durationMs`, `Memory`→`"12.6/13.9 GB"` from stats, `TokensInOut`→`"268 in · 32.8k out"`; `null` when the value is absent.
  - `data class SessionUiState(session: Session? = null, strip: Strip? = null, stats: Stats? = null, chips: List<StripChip> = DEFAULT_STRIP_CHIPS, tab: SessionTab = SessionTab.Terminal, composer: String = "", connection: ConnectionState)`
  - `class SessionViewModel(repo, settings, sessionId) { val ui: StateFlow<SessionUiState>; fun selectTab(t); fun onComposer(text); fun sendLine(); fun sendKeys(bytes: ByteArray); fun answer(pendingId, choices: List<Int>?, text: String?, decision: String?); fun kill(); fun rename(name); fun resume(onNew: (String) -> Unit) }` — `sendLine` writes composer text + `\r` as UTF-8, clears the composer; `ForegroundTracker.set(sessionId)` while the screen is resumed.
  - `class KeyBarState { var ctrlArmed: Boolean; fun press(key: KeyBarKey): ByteArray? }` with `enum class KeyBarKey { Esc, Tab, Ctrl, Up, Down, Left, Right, Enter, Keyboard }`; `Ctrl` arms, next printable key from the composer or `press(Char)` yields `TerminalKeys.ctrl(c)` and disarms.
  - Composables: `SessionScreen(sessionId, onBack, onOpenThread: (String) -> Unit)` with `HorizontalPager` for the two tabs; `StatusStrip(chips: List<String>)` as a `LazyRow` (no scrollbar), hidden when the list is empty; `Composer(value, onChange, onSend, placeholder)`; `KeyBar(state, onBytes, onToggleKeyboard)`; `TerminalTab(bridge, …)`.

- [ ] **Step 1: Write the failing tests**

```kotlin
class StripChipsTest {
    @Test fun rendersCostAndCtx() { val s = Strip(at = "t", costUsd = 3.6, contextUsedPct = 11.0); assertEquals("$3.60", StripChips.render(StripChip.Cost, s, null)); assertEquals("ctx 11%", StripChips.render(StripChip.CtxUsed, s, null)) }
    @Test fun memoryComesFromStats() = assertEquals("12.6/13.9 GB", StripChips.render(StripChip.Memory, null, Stats("t", 13_529_146_982, 14_924_902_400, 34.0, true)))
    @Test fun absentValueIsNull() = assertNull(StripChips.render(StripChip.SevenDay, Strip(at = "t"), null))
}
class KeyBarStateTest { @Test fun ctrlIsStickyForOneKey() { val k = KeyBarState(); assertNull(k.press(KeyBarKey.Ctrl)); assertArrayEquals(byteArrayOf(0x03), k.press('c')); assertFalse(k.ctrlArmed) } }
class SessionViewModelTest {
    @Test fun sendLineAppendsCarriageReturnAndClears() = runTest { vm.onComposer("hello"); vm.sendLine(); assertArrayEquals("hello\r".toByteArray(), repo.lastInput); assertEquals("", vm.ui.value.composer) }
    @Test fun stripHiddenForShellSession() = runTest { /* session kind shell, strip null → ui chips render to empty list */ }
    @Test fun setsForegroundTrackerWhileActive() { }
}
```

- [ ] **Step 2: Run** — `./gradlew :app:testDebugUnitTest --tests '*session*'` → FAIL.

- [ ] **Step 3: Implement** the files. Top bar: back, name, subtitle `<Agent> · <state label>` with state dot, overflow menu (Rename, Kill, Resume, Copy attach command `afk attach <name>`).

- [ ] **Step 4: Run tests** → PASS. Visual check against `03-tabs-themes-features.html` (terminal row) and `04-status-strip-placement.html` option A.

- [ ] **Step 5: Commit** — `git commit -am "android: session screen with terminal tab, composer, key bar, status strip"`

---

### Task 11: Chat tab renderer

**Files:**
- Create: `ui/session/chat/ChatTab.kt`, `ChatReducer.kt`, `ChatEventRow.kt`, `ToolCard.kt`, `SubagentCard.kt`, `PendingCard.kt`, `markdown/Markdown.kt`, `markdown/MdBlock.kt`, `markdown/MarkdownText.kt`
- Test: `ui/session/chat/ChatReducerTest.kt`, `markdown/MarkdownTest.kt`

**Interfaces:**
- Consumes: `SessionsRepository.chat` (Task 5), `SessionViewModel.answer` (Task 10), palette (Task 6).
- Produces:
  - `object ChatReducer { fun apply(current: List<ChatEvent>, update: ChatUpdate): List<ChatEvent> }` — `Snapshot` replaces; `Event` upserts by `id` (tool status updates replace the earlier row), appends otherwise.
  - `sealed interface MdBlock { data class Paragraph(text: AnnotatedString); data class Code(code: String, lang: String?); data class Bullets(items: List<AnnotatedString>) }`
  - `object Markdown { fun parse(text: String): List<MdBlock> }` — supports `**bold**`, `_italic_`/`*italic*`, `` `code` ``, fenced ```` ``` ```` blocks, `- `/`* ` bullets, `[label](url)` → `label` (plain). Inline spans use `SpanStyle(fontWeight = Bold)`, `FontStyle.Italic`, `FontFamily.Monospace`.
  - `@Composable fun MarkdownText(blocks: List<MdBlock>)`, `ChatTab(events, onOpenThread, onAnswer, onFocusComposer)`, `ToolCard(tool, expanded, onToggle)` (one-line summary with status glyph ✓ / ● / ✕; expanded shows `input` and `result` in monospace, capped at 4000 chars with "show more"), `SubagentCard(info, onClick)` (left accent `palette.codex`), `PendingCard(pending, onAnswer, onFocusComposer)` (choices as buttons, `RECOMMENDED` badge, multi-select uses checkboxes + Confirm, "Other…" focuses the composer; permission shows Allow / Always / Deny).

- [ ] **Step 1: Write the failing tests**

```kotlin
class MarkdownTest {
    @Test fun boldItalicCodeSpans() { val p = Markdown.parse("a **b** _c_ `d`")[0] as MdBlock.Paragraph; assertEquals("a b c d", p.text.text); assertEquals(3, p.text.spanStyles.size) }
    @Test fun fencedCodeBecomesBlock() { val b = Markdown.parse("x\n```ts\nlet a=1\n```\ny"); assertTrue(b[1] is MdBlock.Code); assertEquals("ts", (b[1] as MdBlock.Code).lang) }
    @Test fun bulletsGrouped() = assertEquals(2, (Markdown.parse("- one\n- two")[0] as MdBlock.Bullets).items.size)
    @Test fun linkRendersLabelOnly() = assertEquals("see docs", (Markdown.parse("see [docs](https://x)")[0] as MdBlock.Paragraph).text.text)
}
class ChatReducerTest {
    @Test fun eventUpsertsById() { val a = tool("t1", status = ToolStatus.running); val b = a.copy(tool = a.tool!!.copy(status = ToolStatus.ok)); assertEquals(listOf(b), ChatReducer.apply(listOf(a), ChatUpdate.Event(b))) }
    @Test fun snapshotReplaces() { }
}
```

- [ ] **Step 2: Run** — `./gradlew :app:testDebugUnitTest --tests '*chat*' --tests '*markdown*'` → FAIL.

- [ ] **Step 3: Implement** parser (line-based: fences, bullets, paragraphs; inline regex pass for spans) and composables. `ChatTab` is a `LazyColumn` that auto-scrolls to the bottom when already at the bottom; user bubbles right-aligned with `accentSoft`.

- [ ] **Step 4: Run tests** → PASS. Visual check against `03-tabs-themes-features.html` (chat row).

- [ ] **Step 5: Commit** — `git commit -am "android: chat tab with tool, sub-agent, and question cards"`

---

### Task 12: Navigation, deep links, sub-agent thread

**Files:**
- Create: `ui/navigation/Routes.kt`, `AfkNavHost.kt`; `ui/subagent/SubagentScreen.kt`, `SubagentViewModel.kt`
- Modify: `MainActivity.kt` (NavHost, deep link handling), `AndroidManifest.xml` (intent filter `afk://session/*`)
- Test: `ui/navigation/RoutesTest.kt`

**Interfaces:**
- Produces: `object Routes { const val PAIRING = "pairing"; const val SESSIONS = "sessions"; const val NEW = "new"; const val SETTINGS = "settings"; fun session(id: String) = "session/$id"; fun thread(id: String, threadId: String) = "session/$id/thread/$threadId"; fun parseDeepLink(uri: Uri): String? }` — `afk://session/s_1` → `"session/s_1"`.
  - `AfkNavHost(startDestination)`: start is `PAIRING` when `PairingStore.pairing` is null, else `SESSIONS`.
  - `SubagentScreen(sessionId, threadId, onBack)` — `ChatTab` bound to `repo.chat(sessionId, threadId)`, title from the parent event's `subagent.task`.

- [ ] **Step 1: Test** — `RoutesTest.sessionDeepLinkParses()` asserts `"session/s_1"`; `unknownHostIsNull()` for `afk://other/x`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual: tap a notification → session opens; tap a sub-agent card → thread screen.
- [ ] **Step 5: Commit** — `git commit -am "android: navigation, deep links, sub-agent thread screen"`

---

### Task 13: New session screen and folder picker

**Files:**
- Create: `ui/newsession/NewSessionViewModel.kt`, `NewSessionScreen.kt`, `FolderPicker.kt`, `LaunchFlags.kt`
- Test: `ui/newsession/LaunchFlagsTest.kt`, `NewSessionViewModelTest.kt`

**Interfaces:**
- Consumes: `SessionsRepository.listDirs/createSession` (Task 5).
- Produces:
  - `object LaunchFlags { fun chipsFor(kind: SessionKind): List<FlagChip>; fun args(kind: SessionKind, selected: Set<String>, model: String?): List<String> }` with `data class FlagChip(val id: String, val label: String, val needsValue: Boolean = false)`. Claude: `skip` → `--dangerously-skip-permissions`, `continue` → `--continue`, `model` → `--model <value>`. Codex: `yolo` → `--dangerously-bypass-approvals-and-sandbox`, `model` → `--model <value>`. Shell: none.
  - `data class NewSessionUiState(cwd: String = "", kind: SessionKind = SessionKind.claude, flags: Set<String> = setOf("skip"), model: String = "", prompt: String = "", recent: List<String> = emptyList(), browse: ServerMessage.FsDirs? = null, starting: Boolean = false, error: String? = null)`
  - `class NewSessionViewModel(repo) { val ui; fun browse(path: String?); fun pick(path: String); fun setKind(k); fun toggleFlag(id); fun setModel(m); fun setPrompt(p); fun start(onCreated: (String) -> Unit) }` — `start` is disabled when `cwd` is blank; for `shell` it sends empty `args` and `prompt = null`.
  - `NewSessionScreen(onCreated, onClose)`; `FolderPicker(state, onBrowse, onPick)` as a bottom sheet listing `recent` first, then `dirs`, with a path text field.

- [ ] **Step 1: Tests** — `LaunchFlagsTest.claudeSkipProducesFlag()` → `["--dangerously-skip-permissions"]`; `modelFlagCarriesValue()` → contains `"--model", "opus"`; `shellHasNoChips()`; `NewSessionViewModelTest.startSendsCreateWithArgsAndPrompt()` (fake repo records `createSession(cwd, claude, ["--dangerously-skip-permissions"], null, "Run tests")`); `shellIgnoresPrompt()`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; manual: create a shell session from the phone and type `dir`.
- [ ] **Step 5: Commit** — `git commit -am "android: new session screen with laptop folder picker"`

---

### Task 14: App settings store and Settings screen

**Files:**
- Create: `data/settings/AppSettingsStore.kt`, `AppSettings.kt`; `ui/settings/SettingsViewModel.kt`, `SettingsScreen.kt`
- Modify: `MainActivity.kt` (wrap content in `AfkTheme(settings.theme, settings.mode)`), `SessionViewModel` (read `stripChips`), `SessionNotifier` (read `NotificationPrefs`), `TerminalTab` (font size, key bar on/off, and `alwaysDarkTerminal` → `Palettes.terminal(id, dark = true)` regardless of mode)
- Test: `data/settings/AppSettingsStoreTest.kt`, `ui/settings/SettingsViewModelTest.kt`

**Interfaces:**
- Produces:
  - `data class AppSettings(theme: AfkThemeId = AfkThemeId.Graphite, mode: ThemeMode = ThemeMode.System, alwaysDarkTerminal: Boolean = false, stripChips: List<StripChip> = DEFAULT_STRIP_CHIPS, notifications: NotificationPrefs = NotificationPrefs(), terminalFontSp: Int = 12, keyBar: Boolean = true)`
  - `class AppSettingsStore(dataStore) { val settings: StateFlow<AppSettings>; suspend fun update(transform: (AppSettings) -> AppSettings) }`
  - `class SettingsViewModel(store, repo, pairingStore) { val ui: StateFlow<SettingsUiState>; fun setTheme/Mode/AlwaysDark/Chips/Notif/FontSize/KeyBar; fun setKeepAwake(on: Boolean); fun unpair(onDone) }` — `setKeepAwake` calls `repo.setDaemonSettings(DaemonSettingsPatch(keepAwake = on))`; `unpair` confirms, clears the pairing store, stops `AfkConnectionService`.
  - `SettingsScreen(onBack, onUnpaired)` sections exactly: Laptop (hostname, address, Keep awake switch with note "Releases 10 min after the last agent goes idle", Unpair), Appearance (Theme chips incl. Dynamic on 31+, Mode segmented, Always dark terminal), Status strip (toggle chips in order), Notifications (three switches), Terminal (font size slider 10–20, Key bar switch), About (version, licenses).

- [ ] **Step 1: Tests** — `AppSettingsStoreTest.defaultsMatchSpec()` (Graphite, System, chips == DEFAULT_STRIP_CHIPS, subagents off, font 12); `roundTripsTheme()`; `SettingsViewModelTest.keepAwakeToggleSendsDaemonSettingsSet()` (fake repo records patch `keepAwake=false`); `unpairClearsStoreAndStopsService()`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; visual check against the Settings frame in `03-tabs-themes-features.html`.
- [ ] **Step 5: Commit** — `git commit -am "android: app settings and settings screen"`

---

### Task 15: Icon, splash, About and licenses

**Files:**
- Create: `app/src/main/res/drawable/ic_launcher_foreground.xml`, `ic_launcher_monochrome.xml`, `res/values/ic_launcher_background.xml` (`#0A0C18`), `res/mipmap-anydpi-v26/ic_launcher.xml`, `assets/icon.svg` (repo root), `ui/settings/AboutScreen.kt`, `app/src/main/assets/licenses/TERMUX-LICENSE.txt`, `NOTICE.txt`
- Modify: `AndroidManifest.xml` (icon, roundIcon, splash theme), `res/values/themes.xml` (`Theme.SplashScreen` with the icon)

**Interfaces:** `AboutScreen(onBack)` shows `BuildConfig.VERSION_NAME`, a link to the repo, and the Termux Apache-2.0 notice.

- [ ] **Step 1:** Write `assets/icon.svg` from the mockup: `viewBox 0 0 1024 1024`, background `rect rx=230 fill=#0a0c18`, chevron `M300 330 L560 512 L300 694` stroke-width 120 round caps/joins, arc `M520 400 Q 690 270 800 440` stroke-width 46, phone `rect x=660 y=480 w=200 h=300 rx=44` stroke-width 46, home line `732,728 → 788,728` width 24; gradient `#b9a6ff → #8ef0d6` at 45°. Convert the glyph paths to the Android vector drawable (108 dp canvas, glyph inside the 66 dp safe zone); monochrome variant white, same paths.
- [ ] **Step 2:** Verify — `./gradlew :app:assembleDebug`; install; launcher icon, themed icon (Android 13 setting), and splash render; About shows the notice.
- [ ] **Step 3: Commit** — `git commit -am "android: adaptive icon, splash, about and licenses"`

---

### Task 16: Offline banner, accessibility, QA checklist, docs, release workflow

**Files:**
- Create: `ui/components/OfflineBanner.kt`, `docs/qa-checklist-android.md`, `.github/workflows/release.yml`
- Modify: `README.md` (Android section: install APK from Releases, pairing, battery-optimisation note), every screen (content descriptions, 48 dp touch targets, `semantics` on state dots), `SessionsScreen` (banner when `connection !is Connected`)
- Test: `ui/components/OfflineBannerTest.kt` (androidTest, optional), ktlint

**Interfaces:** `OfflineBanner(connection: ConnectionState)` — "Reconnecting to <host>… (attempt n)" / "Not connected"; hidden when `Connected`.

- [ ] **Step 1:** Implement the banner and an accessibility pass: every icon button has `contentDescription`; state dots carry `semantics { stateDescription = "Needs your input" }`; text scales with system font size (no fixed `sp` overrides below 11 sp).
- [ ] **Step 2:** Write `docs/qa-checklist-android.md`: pairing by QR and by hand; list updates live; needs-input notification with choice actions; finished notification with inline reply; notification suppressed while session open; terminal matches laptop; rotate once → one resize; chat question answered from card; sub-agent thread opens; new shell session, `dir` works; new Claude session with prompt; keep-awake toggle reflected in `stats.keepAwakeActive`; each theme light/dark; Dynamic on API 31+; unpair stops the service; reconnect after toggling Wi-Fi.
- [ ] **Step 3:** `release.yml`: on tag `v*`, build `assembleRelease`; if secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` exist, sign with them, else build with the debug signing config so the artifact installs; upload `afk-<tag>.apk` to the GitHub Release.
- [ ] **Step 4:** README Android section with screenshots from `docs/screenshots/` (capture from the phone in Aurora dark).
- [ ] **Step 5:** Verify — `./gradlew :app:ktlintCheck :app:testDebugUnitTest :app:assembleRelease` passes; run the QA checklist on the phone and tick every line.
- [ ] **Step 6: Commit** — `git commit -am "android: offline banner, accessibility pass, QA checklist, release workflow"`
