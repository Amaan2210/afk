package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DaemonSettingsPatch
import io.github.amaankhan63.afk.data.protocol.DirEntry
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // runCurrent
class SessionsRepositoryTest {
    private val manager = FakeConnectionManager()

    private fun TestScope.repo() = DefaultSessionsRepository(manager, backgroundScope)

    private class Collected<T>(val items: List<T>, val job: Job)

    /** Collects [flow] in the background until the test ends or [Collected.job] is cancelled. */
    private fun <T> TestScope.collecting(flow: Flow<T>): Collected<T> {
        val items = mutableListOf<T>()
        val job = backgroundScope.launch { flow.toList(items) }
        runCurrent()
        return Collected(items, job)
    }

    /** What collecting [flow] threw. */
    private suspend fun TestScope.failureOf(flow: Flow<*>): Throwable? {
        val result = async { runCatching { flow.collect {} } }
        runCurrent()
        return result.await().exceptionOrNull()
    }

    private fun Result<*>.errorCode() = (exceptionOrNull() as AfkError).code

    private fun subscribe(cols: Int = 80, rows: Int = 24) =
        ClientMessage.PtySubscribe(REQUEST_ID, "s_1", cols, rows)

    private fun snapshot(data: String, sessionId: String = "s_1") =
        ServerMessage.PtySnapshot(sessionId, 80, 24, data)

    private fun shown(text: String) = PtyFrame.Snapshot(80, 24, text.toByteArray())

    private fun typed(text: String) = PtyFrame.Data(text.toByteArray())

    @Test fun ptySubscribeSendsSubscribeAndDecodesBase64() = runTest {
        val repo = repo()
        manager.connect()
        // The snapshot lands right behind the ack, before request() returns, as the real manager
        // can deliver it; it is caught only if the repository listens before it asks.
        manager.onRequest = {
            manager.receive(snapshot("aGk="))
            ServerMessage.Ack(REQUEST_ID)
        }
        val frames = collecting(repo.pty("s_1", 80, 24))
        manager.receive(ServerMessage.PtyData("s_1", "IHRoZXJl"))
        manager.receive(ServerMessage.PtyResized("s_1", 100, 30))
        runCurrent()

        assertEquals(listOf(subscribe()), manager.requests)
        assertEquals(
            listOf(shown("hi"), typed(" there"), PtyFrame.Resized(100, 30)),
            frames.items
        )
    }

    @Test fun ptyDropsOtherSessionsAndFramesBeforeItsSnapshot() = runTest {
        val repo = repo()
        manager.connect()
        val frames = collecting(repo.pty("s_1", 80, 24))
        // Left over from an earlier subscription on this connection.
        manager.receive(ServerMessage.PtyData("s_1", "c3RhbGU="))
        manager.receive(snapshot("b2xk", sessionId = "s_2"))
        manager.receive(snapshot("aGk="))
        manager.receive(ServerMessage.PtyData("s_2", "IQ=="))
        manager.receive(ServerMessage.PtyData("s_1", "IQ=="))
        runCurrent()

        assertEquals(listOf(shown("hi"), typed("!")), frames.items)
    }

    @Test fun ptyResubscribesOnReconnect() = runTest {
        val repo = repo()
        manager.connect()
        val frames = collecting(repo.pty("s_1", 80, 24))
        manager.receive(snapshot("aGk="))
        runCurrent()

        manager.drop()
        runCurrent()
        manager.connect()
        runCurrent()
        manager.receive(snapshot("Ynll"))
        manager.receive(ServerMessage.PtyData("s_1", "IQ=="))
        runCurrent()

        assertEquals(listOf(subscribe(), subscribe()), manager.requests)
        assertEquals(emptyList<ClientMessage>(), manager.sent)
        // Each frame once: the first connection's listener is gone.
        assertEquals(listOf(shown("hi"), shown("bye"), typed("!")), frames.items)
    }

    @Test fun ptyResubscribesAtTheLatestGrid() = runTest {
        val repo = repo()
        manager.connect()
        collecting(repo.pty("s_1", 80, 24))
        repo.ptyResize("s_1", 100, 30)

        manager.drop()
        runCurrent()
        manager.connect()
        runCurrent()

        assertEquals(listOf(subscribe(80, 24), subscribe(100, 30)), manager.requests)
    }

    @Test fun ptyWaitsForAConnectionLostBeforeItsReply() = runTest {
        val repo = repo()
        val frames = collecting(repo.pty("s_1", 80, 24))
        assertEquals(emptyList<ClientMessage>(), manager.requests)

        manager.onRequest = {
            manager.drop()
            throw AfkError(ERROR_DISCONNECTED, "connection lost")
        }
        manager.connect()
        runCurrent()
        assertTrue(frames.job.isActive)

        manager.onRequest = { ServerMessage.Ack(REQUEST_ID) }
        manager.connect()
        runCurrent()
        manager.receive(snapshot("aGk="))
        runCurrent()

        assertEquals(listOf(subscribe(), subscribe()), manager.requests)
        assertEquals(listOf(shown("hi")), frames.items)
    }

    @Test fun ptyCancelSendsOneUnsubscribe() = runTest {
        val repo = repo()
        manager.connect()
        val frames = collecting(repo.pty("s_1", 80, 24))

        frames.job.cancel()
        runCurrent()

        assertEquals(listOf(ClientMessage.PtyUnsubscribe("s_1")), manager.sent)
    }

    @Test fun ptyErrorReplyFailsTheFlow() = runTest {
        val repo = repo()
        manager.connect()
        manager.onRequest = { ServerMessage.Error(REQUEST_ID, "not_found", "no session s_9") }

        val error = failureOf(repo.pty("s_9", 80, 24))

        assertTrue(error is AfkError)
        assertEquals("not_found", (error as AfkError).code)
        assertEquals("no session s_9", error.message)
    }

    @Test fun ptySubscribeTimeoutFailsTheFlow() = runTest {
        val repo = repo()
        manager.connect()
        manager.onRequest = { awaitCancellation() }

        val error = failureOf(repo.pty("s_1", 80, 24))

        assertEquals(ERROR_TIMEOUT, (error as AfkError).code)
    }

    @Test fun ptyInputAndResizeAreSent() = runTest {
        val repo = repo()
        repo.ptyInput("s_1", "ls\r".toByteArray())
        repo.ptyResize("s_1", 100, 30)
        assertEquals(
            listOf(
                ClientMessage.PtyInput("s_1", "bHMN"),
                ClientMessage.PtyResize("s_1", 100, 30)
            ),
            manager.sent
        )
    }

    @Test fun chatFollowsOneThreadAndResubscribes() = runTest {
        val repo = repo()
        manager.connect()
        val first = chatEvent("e1")
        val second = chatEvent("e2")
        val updates = collecting(repo.chat("s_1"))
        manager.receive(ServerMessage.ChatEventMsg("s_1", "main", chatEvent("e0")))
        manager.receive(ServerMessage.ChatSnapshot("s_1", "main", listOf(first)))
        manager.receive(
            ServerMessage.ChatEventMsg("s_1", "t_2", chatEvent("x1", threadId = "t_2"))
        )
        manager.receive(ServerMessage.ChatEventMsg("s_2", "main", chatEvent("x2")))
        manager.receive(ServerMessage.ChatEventMsg("s_1", "main", second))
        runCurrent()

        manager.drop()
        runCurrent()
        manager.connect()
        runCurrent()
        manager.receive(ServerMessage.ChatSnapshot("s_1", "main", listOf(first, second)))
        runCurrent()
        updates.job.cancel()
        runCurrent()

        val subscribe = ClientMessage.ChatSubscribe(REQUEST_ID, "s_1", "main")
        assertEquals(listOf(subscribe, subscribe), manager.requests)
        assertEquals(
            listOf(
                ChatUpdate.Snapshot(listOf(first)),
                ChatUpdate.Event(second),
                ChatUpdate.Snapshot(listOf(first, second))
            ),
            updates.items
        )
        assertEquals(listOf(ClientMessage.ChatUnsubscribe("s_1", "main")), manager.sent)
    }

    @Test fun sessionsAreSortedAndKeptWhileDisconnected() = runTest {
        val repo = repo()
        manager.connect()
        manager.receive(
            ServerMessage.SessionsSnapshot(
                listOf(
                    session("s_1", state = SessionState.idle),
                    session("s_2", state = SessionState.needs_input)
                )
            )
        )
        manager.receive(
            ServerMessage.SessionUpdated(session("s_3", state = SessionState.finished))
        )
        runCurrent()
        assertEquals(listOf("s_2", "s_3", "s_1"), repo.sessions.value.map { it.id })

        manager.drop()
        runCurrent()
        assertEquals(listOf("s_2", "s_3", "s_1"), repo.sessions.value.map { it.id })

        manager.connect()
        manager.receive(ServerMessage.SessionsSnapshot(listOf(session("s_4"))))
        runCurrent()
        assertEquals(listOf("s_4"), repo.sessions.value.map { it.id })
    }

    @Test fun sessionFollowsOneSession() = runTest {
        val repo = repo()
        val idle = session("s_1")
        val busy = idle.copy(state = SessionState.working)
        val seen = collecting(repo.session("s_1"))

        manager.receive(ServerMessage.SessionsSnapshot(listOf(idle, session("s_2"))))
        runCurrent()
        manager.receive(
            ServerMessage.SessionUpdated(session("s_2", state = SessionState.working))
        )
        runCurrent()
        manager.receive(ServerMessage.SessionUpdated(busy))
        runCurrent()
        manager.receive(ServerMessage.SessionRemoved("s_1"))
        runCurrent()

        assertEquals(listOf(null, idle, busy, null), seen.items)
    }

    @Test fun pushesFeedStatsAndDaemonSettings() = runTest {
        val repo = repo()
        val at = "2026-10-30T10:00:00.000Z"
        manager.receive(ServerMessage.StatsMsg(at, 6_000, 16_000, 34.5, true))
        manager.receive(
            ServerMessage.DaemonSettingsMsg(settings = DaemonSettings(keepAwake = false))
        )
        runCurrent()

        assertEquals(Stats(at, 6_000, 16_000, 34.5, true), repo.stats.value)
        assertEquals(DaemonSettings(keepAwake = false), repo.daemonSettings.value)
    }

    @Test fun stripFollowsUpdatesAndIsDroppedWithItsSession() = runTest {
        val repo = repo()
        val first = repo.strip("s_1")
        val costly = Strip(at = "2026-10-30T10:00:00.000Z", costUsd = 3.6)
        manager.receive(ServerMessage.SessionsSnapshot(listOf(session("s_1"), session("s_2"))))
        manager.receive(ServerMessage.StripUpdate("s_1", costly))
        manager.receive(ServerMessage.StripUpdate("s_2", costly))
        runCurrent()
        assertEquals(costly, first.value)
        val second = repo.strip("s_2")
        assertEquals(costly, second.value)

        manager.receive(ServerMessage.SessionRemoved("s_1"))
        // s_2 went away while the phone was offline: the next snapshot no longer lists it.
        manager.receive(ServerMessage.SessionsSnapshot(listOf(session("s_3"))))
        runCurrent()

        assertNull(first.value)
        assertNull(second.value)
        assertNull(repo.strip("s_1").value)
    }

    @Test fun killMapsErrorToFailure() = runTest {
        val repo = repo()
        manager.connect()
        manager.onRequest = { ServerMessage.Error(REQUEST_ID, "not_found", "no session s_9") }

        val result = repo.killSession("s_9")

        assertEquals(listOf(ClientMessage.SessionKill(REQUEST_ID, "s_9")), manager.requests)
        assertEquals("not_found", result.errorCode())
        assertEquals("no session s_9", result.exceptionOrNull()?.message)
    }

    @Test fun createSessionReturnsTheAckedId() = runTest {
        val repo = repo()
        manager.connect()
        manager.onRequest = { ServerMessage.Ack(REQUEST_ID, sessionId = "s_new") }

        val result = repo.createSession(
            "D:\\projects\\app",
            SessionKind.claude,
            listOf("--continue"),
            "app",
            "fix the tests"
        )

        assertEquals(Result.success("s_new"), result)
        assertEquals(
            listOf(
                ClientMessage.SessionCreate(
                    REQUEST_ID,
                    "D:\\projects\\app",
                    SessionKind.claude,
                    listOf("--continue"),
                    "app",
                    "fix the tests"
                )
            ),
            manager.requests
        )
    }

    @Test fun ackWithoutSessionIdIsInternal() = runTest {
        val repo = repo()
        manager.connect()

        val created =
            repo.createSession("D:\\projects\\app", SessionKind.shell, emptyList(), null, null)
        val resumed = repo.resumeSession("s_1")

        assertEquals("internal", created.errorCode())
        assertEquals("internal", resumed.errorCode())
    }

    @Test fun resumeReturnsTheNewSessionId() = runTest {
        val repo = repo()
        manager.connect()
        manager.onRequest = { ServerMessage.Ack(REQUEST_ID, sessionId = "s_2") }

        assertEquals(Result.success("s_2"), repo.resumeSession("s_1"))
        assertEquals(listOf(ClientMessage.SessionResume(REQUEST_ID, "s_1")), manager.requests)
    }

    @Test fun renameSucceedsOnAck() = runTest {
        val repo = repo()
        manager.connect()

        assertEquals(Result.success(Unit), repo.renameSession("s_1", "api"))
        assertEquals(
            listOf(ClientMessage.SessionRename(REQUEST_ID, "s_1", "api")),
            manager.requests
        )
    }

    @Test fun pendingChangedPassesThroughWithoutRetry() = runTest {
        val repo = repo()
        manager.connect()
        manager.onRequest = {
            ServerMessage.Error(REQUEST_ID, "pending_changed", "the rest was not typed")
        }

        val result = repo.answerPending("s_1", "p_1", choices = listOf(0, 2))

        assertEquals("pending_changed", result.errorCode())
        assertEquals(
            listOf(
                ClientMessage.PendingAnswer(REQUEST_ID, "s_1", "p_1", choiceIndices = listOf(0, 2))
            ),
            manager.requests
        )
    }

    @Test fun answerCarriesTextOrDecision() = runTest {
        val repo = repo()
        manager.connect()

        assertTrue(repo.answerPending("s_1", "p_1", text = "use the second").isSuccess)
        assertTrue(repo.answerPending("s_1", "p_2", decision = "allow").isSuccess)

        assertEquals(
            listOf(
                ClientMessage.PendingAnswer(REQUEST_ID, "s_1", "p_1", text = "use the second"),
                ClientMessage.PendingAnswer(REQUEST_ID, "s_1", "p_2", decision = "allow")
            ),
            manager.requests
        )
    }

    @Test fun requestWhileDisconnectedFailsWithDisconnected() = runTest {
        val repo = repo()
        assertEquals(ERROR_DISCONNECTED, repo.killSession("s_1").errorCode())
    }

    @Test fun requestTimeoutFailsWithTimeout() = runTest {
        val repo = repo()
        manager.connect()
        manager.onRequest = { awaitCancellation() }

        assertEquals(ERROR_TIMEOUT, repo.renameSession("s_1", "api").errorCode())
    }

    @Test fun listDirsAndSetDaemonSettingsReturnTheirReplies() = runTest {
        val repo = repo()
        manager.connect()
        val dirs = ServerMessage.FsDirs(
            id = REQUEST_ID,
            path = "D:\\projects",
            parent = "D:\\",
            dirs = listOf(DirEntry("app", "D:\\projects\\app")),
            recent = listOf("D:\\projects\\app")
        )
        val settings = DaemonSettings(retentionHours = 48)
        manager.onRequest = { msg ->
            when (msg) {
                is ClientMessage.FsListDirs -> dirs
                else -> ServerMessage.DaemonSettingsMsg(REQUEST_ID, settings)
            }
        }

        assertEquals(Result.success(dirs), repo.listDirs("D:\\projects"))
        val patch = DaemonSettingsPatch(retentionHours = 48)
        assertEquals(Result.success(settings), repo.setDaemonSettings(patch))
        assertEquals(
            listOf(
                ClientMessage.FsListDirs(REQUEST_ID, "D:\\projects"),
                ClientMessage.DaemonSettingsSet(REQUEST_ID, patch)
            ),
            manager.requests
        )
    }

    @Test fun notificationsForwarded() = runTest {
        val repo = repo()
        val notify = ServerMessage.Notify(
            event = "needs_input",
            sessionId = "s_1",
            sessionName = "app",
            title = "app needs input",
            body = "Run the migration?"
        )
        val next = async { repo.notifications.first() }
        runCurrent()

        manager.receive(notify)

        assertEquals(notify, next.await())
    }

    @Test fun filterDoneIncludesFinishedAndEnded() {
        val done = SessionFilter(StateFilter.Done)
        assertTrue(done.accepts(session(state = SessionState.finished)))
        assertTrue(done.accepts(session(state = SessionState.ended)))
        assertFalse(done.accepts(session(state = SessionState.working)))
        assertFalse(done.accepts(session(state = SessionState.idle)))
        assertFalse(done.accepts(session(state = SessionState.needs_input)))
    }

    @Test fun filterByNeedsYouWorkingAndAgent() {
        val needsYou = SessionFilter(StateFilter.NeedsYou)
        val working = SessionFilter(StateFilter.Working)
        assertTrue(needsYou.accepts(session(state = SessionState.needs_input)))
        assertFalse(needsYou.accepts(session(state = SessionState.idle)))
        assertTrue(working.accepts(session(state = SessionState.working)))
        assertFalse(working.accepts(session(state = SessionState.finished)))
        assertTrue(SessionFilter().accepts(session(kind = SessionKind.shell)))

        val codex = SessionFilter(agents = setOf(SessionKind.codex))
        assertTrue(codex.accepts(session(kind = SessionKind.codex)))
        assertFalse(codex.accepts(session(kind = SessionKind.claude)))
        val doneCodex = SessionFilter(StateFilter.Done, setOf(SessionKind.codex))
        assertFalse(doneCodex.accepts(session(kind = SessionKind.codex)))
    }
}
