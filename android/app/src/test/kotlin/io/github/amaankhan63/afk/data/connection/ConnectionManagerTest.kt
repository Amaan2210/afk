package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.DaemonInfo
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DeviceInfo
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import kotlin.random.Random
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // runCurrent, advanceTimeBy, currentTime
class ConnectionManagerTest {
    private val socket = FakeAfkSocket()
    private val endpoint = Endpoint("100.84.12.9")
    private val hello = ServerMessage.Hello(
        protocol = 1,
        daemon = DaemonInfo("0.1.0", "MY-LAPTOP", "win32", "100.84.12.9"),
        device = DeviceInfo("dev_8f3a", "Pixel 8")
    )
    private val kill = ClientMessage.SessionKill(id = "r1", sessionId = "s_1")

    private fun TestScope.manager() =
        DefaultConnectionManager(socket, Backoff(random = Random(SEED)), backgroundScope, "Pixel 8")

    private fun TestScope.connectedManager(): DefaultConnectionManager {
        val manager = manager()
        manager.start(endpoint, "tok")
        runCurrent()
        socket.receive(hello)
        runCurrent()
        return manager
    }

    /** Starts [request]; the result holds what it returned or threw. */
    private fun TestScope.requestAsync(
        manager: ConnectionManager,
        request: ClientMessage = kill
    ): Deferred<Result<ServerMessage>> {
        val reply = async { runCatching { manager.request(request) } }
        runCurrent()
        return reply
    }

    private fun Throwable?.isAfkError(code: String) = this is AfkError && this.code == code

    @Test fun becomesConnectedOnHello() = runTest {
        val manager = manager()
        assertEquals(ConnectionState.Disconnected, manager.state.value)

        manager.start(endpoint, "tok")
        runCurrent()
        assertEquals(ConnectionState.Connecting(0), manager.state.value)
        assertEquals(listOf("tok"), socket.opens)

        socket.receive(hello)
        runCurrent()
        assertEquals(ConnectionState.Connected(hello), manager.state.value)
    }

    @Test fun reconnectsAfterServerClose() = runTest {
        val manager = connectedManager()

        socket.serverCloses()
        runCurrent()
        assertEquals(ConnectionState.Connecting(1), manager.state.value)

        val wait = Backoff(random = Random(SEED)).delayMs(0)
        advanceTimeBy(wait - 1)
        runCurrent()
        assertEquals(1, socket.opens.size)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(2, socket.opens.size)
    }

    @Test fun backoffGrowsUntilHelloThenStartsOver() = runTest {
        val expected = Backoff(random = Random(SEED))
        val manager = manager()
        manager.start(endpoint, "tok")
        runCurrent()

        socket.fails()
        runCurrent()
        assertEquals(ConnectionState.Connecting(1), manager.state.value)
        advanceTimeBy(expected.delayMs(0))
        runCurrent()
        assertEquals(2, socket.opens.size)

        socket.fails()
        runCurrent()
        assertEquals(ConnectionState.Connecting(2), manager.state.value)
        val secondWait = expected.delayMs(1)
        assertTrue(secondWait >= 1_000)
        advanceTimeBy(secondWait - 1)
        runCurrent()
        assertEquals(2, socket.opens.size)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(3, socket.opens.size)

        socket.receive(hello)
        runCurrent()
        assertEquals(ConnectionState.Connected(hello), manager.state.value)
        socket.serverCloses()
        runCurrent()
        assertEquals(ConnectionState.Connecting(1), manager.state.value)
    }

    @Test fun stopsOnUnauthorized() = runTest {
        val manager = manager()
        manager.start(endpoint, "bad")
        runCurrent()

        // The daemon's rejection: an id-less error with the close right behind it.
        socket.receive(ServerMessage.Error(code = "unauthorized", message = "unknown token"))
        socket.serverCloses(4001, "unauthorized")
        runCurrent()
        assertEquals(ConnectionState.Failed("unauthorized"), manager.state.value)

        advanceTimeBy(10 * 60_000L)
        assertEquals(1, socket.opens.size)
        assertEquals(ConnectionState.Failed("unauthorized"), manager.state.value)
    }

    @Test fun stopsOnProtocolMismatch() = runTest {
        val manager = manager()
        manager.start(endpoint, "tok")
        runCurrent()

        socket.receive(ServerMessage.Error(code = "protocol_mismatch", message = "protocol 2"))
        socket.serverCloses(4002, "protocol_mismatch")
        advanceTimeBy(10 * 60_000L)
        assertEquals(ConnectionState.Failed("protocol_mismatch"), manager.state.value)
        assertEquals(1, socket.opens.size)
    }

    @Test fun rejectionWhileConnectedFailsPendingRequests() = runTest {
        val manager = connectedManager()
        val reply = requestAsync(manager)

        socket.receive(ServerMessage.Error(code = "unauthorized", message = "device removed"))
        runCurrent()
        assertTrue(reply.await().exceptionOrNull().isAfkError("unauthorized"))
        assertEquals(ConnectionState.Failed("unauthorized"), manager.state.value)
    }

    @Test fun requestResolvesAckById() = runTest {
        val manager = connectedManager()
        val reply = requestAsync(manager, ClientMessage.SessionKill(id = "r1", sessionId = "s_1"))

        assertEquals(ClientMessage.SessionKill(id = "r1", sessionId = "s_1"), socket.sent.single())
        socket.receive(ServerMessage.Ack(id = "r1"))
        runCurrent()
        assertEquals(ServerMessage.Ack(id = "r1"), reply.await().getOrThrow())
    }

    @Test fun requestsGetFreshIdsAndResolveInAnyOrder() = runTest {
        val manager = connectedManager()
        val first = requestAsync(manager, ClientMessage.SessionKill(id = "", sessionId = "s_1"))
        val second = requestAsync(manager, ClientMessage.SessionKill(id = "", sessionId = "s_2"))
        assertEquals(listOf("r1", "r2"), socket.sent.map { (it as ClientMessage.SessionKill).id })

        val notFound = ServerMessage.Error(id = "r2", code = "not_found", message = "no s_2")
        socket.receive(notFound)
        socket.receive(ServerMessage.Ack(id = "r1"))
        runCurrent()
        assertEquals(ServerMessage.Ack(id = "r1"), first.await().getOrThrow())
        assertEquals(notFound, second.await().getOrThrow())
    }

    @Test fun idLessErrorIsANoticeNotAReply() = runTest {
        val manager = connectedManager()
        val seen = mutableListOf<ServerMessage>()
        backgroundScope.launch(start = CoroutineStart.UNDISPATCHED) {
            manager.incoming.toList(seen)
        }
        val reply = requestAsync(manager)

        val notice = ServerMessage.Error(code = "bad_request", message = "pty.input: bad data")
        socket.receive(notice)
        socket.receive(ServerMessage.Ack(id = "r99"))
        runCurrent()
        assertFalse(reply.isCompleted)
        assertEquals(listOf(notice, ServerMessage.Ack(id = "r99")), seen)

        socket.receive(ServerMessage.Ack(id = "r1"))
        runCurrent()
        assertEquals(ServerMessage.Ack(id = "r1"), reply.await().getOrThrow())
    }

    @Test fun repliesAreAlsoForwardedOnIncoming() = runTest {
        val manager = connectedManager()
        val seen = mutableListOf<ServerMessage>()
        backgroundScope.launch(start = CoroutineStart.UNDISPATCHED) {
            manager.incoming.toList(seen)
        }
        val reply = requestAsync(manager, ClientMessage.DaemonSettingsGet(id = ""))

        val settings = ServerMessage.DaemonSettingsMsg(id = "r1", settings = DaemonSettings())
        socket.receive(settings)
        runCurrent()
        assertEquals(settings, reply.await().getOrThrow())
        assertEquals(listOf<ServerMessage>(settings), seen)
    }

    @Test fun requestTimesOut() = runTest {
        val manager = connectedManager()

        val error = runCatching { manager.request(kill, timeoutMs = 1_000) }.exceptionOrNull()
        assertTrue(error is TimeoutCancellationException)
        assertEquals(1_000L, currentTime)
    }

    @Test fun pendingRequestFailsWhenTheConnectionDrops() = runTest {
        val manager = connectedManager()
        val reply = requestAsync(manager)

        socket.serverCloses(1001, "daemon shutting down")
        runCurrent()
        assertTrue(reply.await().exceptionOrNull().isAfkError(ERROR_DISCONNECTED))
    }

    @Test fun requestFailsFastAndSendIsDroppedWhenNotConnected() = runTest {
        val manager = manager()
        manager.start(endpoint, "tok")
        runCurrent()

        val error = runCatching { manager.request(kill) }.exceptionOrNull()
        assertTrue(error.isAfkError(ERROR_DISCONNECTED))
        manager.send(ClientMessage.PtyInput(sessionId = "s_1", data = "aGk="))
        assertEquals(emptyList<ClientMessage>(), socket.sent)
        assertEquals(0L, currentTime)
    }

    @Test fun sendGoesOutWhenConnected() = runTest {
        val manager = connectedManager()
        val input = ClientMessage.PtyInput(sessionId = "s_1", data = "aGk=")

        manager.send(input)
        assertEquals(listOf<ClientMessage>(input), socket.sent)
    }

    @Test fun requestRejectsAMessageWithoutId() = runTest {
        val manager = connectedManager()
        val resize = ClientMessage.PtyResize(sessionId = "s_1", cols = 80, rows = 24)

        val error = runCatching { manager.request(resize) }.exceptionOrNull()
        assertTrue(error is IllegalArgumentException)
        assertEquals(emptyList<ClientMessage>(), socket.sent)
    }

    @Test fun stopClosesTheSocketAndNeverReconnects() = runTest {
        val manager = connectedManager()
        val reply = requestAsync(manager)

        manager.stop()
        assertEquals(ConnectionState.Disconnected, manager.state.value)
        assertFalse(socket.isOpen)
        advanceTimeBy(10 * 60_000L)
        assertEquals(1, socket.opens.size)
        assertEquals(ConnectionState.Disconnected, manager.state.value)
        assertTrue(reply.await().exceptionOrNull().isAfkError(ERROR_DISCONNECTED))
    }

    @Test fun startAgainReplacesTheConnection() = runTest {
        val manager = connectedManager()
        val reply = requestAsync(manager)

        manager.start(Endpoint("100.84.12.10"), "new")
        runCurrent()
        assertEquals(listOf("tok", "new"), socket.opens)
        assertEquals(ConnectionState.Connecting(0), manager.state.value)
        assertTrue(reply.await().exceptionOrNull().isAfkError(ERROR_DISCONNECTED))
        socket.receive(hello)
        runCurrent()
        assertEquals(ConnectionState.Connected(hello), manager.state.value)
    }

    private companion object {
        const val SEED = 42
    }
}
