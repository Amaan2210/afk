package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.AfkJson
import io.github.amaankhan63.afk.data.protocol.ClientInfo
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.DaemonInfo
import io.github.amaankhan63.afk.data.protocol.DeviceInfo
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The real OkHttp socket against a local WebSocket server, in real time. */
class AfkSocketTest {
    private val server = MockWebServer()
    private val client = OkHttpClient()
    private val socket = OkHttpAfkSocket(client)

    /** Text frames the server received, in order. */
    private val received = LinkedBlockingQueue<String>()

    private val endpoint get() = Endpoint(server.hostName, server.port)

    @Before fun setUp() = server.start()

    @After fun tearDown() {
        socket.close()
        server.close()
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    /** Upgrades the next request to a WebSocket that records each text frame and runs [onText]. */
    private fun serveWebSocket(onText: (WebSocket, String) -> Unit = { _, _ -> }) {
        val listener = object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                received.put(text)
                onText(webSocket, text)
            }

            // Answers the client's close, as the daemon does, so the server can shut down.
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }
        }
        server.enqueue(MockResponse.Builder().webSocketUpgrade(listener).build())
    }

    @Test fun sendsAuthAsFirstFrame() {
        serveWebSocket()
        socket.open(endpoint, "tok", "Pixel 8")

        val first = checkNotNull(received.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS)) { "no frame" }
        val auth = ClientMessage.Auth(
            token = "tok",
            protocol = 1,
            client = ClientInfo("android", "Pixel 8")
        )
        assertEquals(auth, AfkJson.json.decodeFromString(ClientMessage.serializer(), first))
        val upgrade = checkNotNull(server.takeRequest(TIMEOUT_MS, TimeUnit.MILLISECONDS))
        assertEquals("/ws", upgrade.url.encodedPath)
    }

    @Test fun emitsDecodedIncoming() = runBlocking {
        serveWebSocket { webSocket, _ -> webSocket.send(HELLO) }
        val first = async(start = CoroutineStart.UNDISPATCHED) { socket.incoming.first() }
        socket.open(endpoint, "tok", "Pixel 8")

        val hello = ServerMessage.Hello(
            protocol = 1,
            daemon = DaemonInfo("0.1.0", "MY-LAPTOP", "win32", "100.84.12.9"),
            device = DeviceInfo("dev_8f3a", "Pixel 8")
        )
        assertEquals(hello, withTimeout(TIMEOUT_MS) { first.await() })
    }

    @Test fun dropsUndecodableFramesAndStaysOpen() = runBlocking {
        serveWebSocket { webSocket, _ ->
            webSocket.send("not json")
            webSocket.send("""{"no":"type"}""")
            webSocket.send(SESSION_IN_UNKNOWN_STATE)
            webSocket.send(HELLO)
        }
        val failures = async(start = CoroutineStart.UNDISPATCHED) {
            socket.events.filterIsInstance<SocketEvent.DecodeFailure>().take(3).toList()
        }
        val first = async(start = CoroutineStart.UNDISPATCHED) { socket.incoming.first() }
        socket.open(endpoint, "tok", "Pixel 8")

        withTimeout(TIMEOUT_MS) {
            assertEquals(3, failures.await().size)
            assertTrue(first.await() is ServerMessage.Hello)
        }
    }

    @Test fun reportsTheServerCloseOnceAndOpensAgain() = runBlocking {
        serveWebSocket { webSocket, _ ->
            webSocket.send("""{"type":"error","code":"unauthorized","message":"unknown token"}""")
            webSocket.close(4001, "unauthorized")
        }
        serveWebSocket()
        val events = Channel<SocketEvent>(Channel.UNLIMITED)
        val collector = launch(start = CoroutineStart.UNDISPATCHED) {
            socket.events.collect { events.send(it) }
        }
        val rejection = async(start = CoroutineStart.UNDISPATCHED) { socket.incoming.first() }

        withTimeout(TIMEOUT_MS) {
            socket.open(endpoint, "bad", "Pixel 8")
            assertEquals(SocketEvent.Opened, events.receive())
            assertEquals(
                ServerMessage.Error(code = "unauthorized", message = "unknown token"),
                rejection.await()
            )
            assertEquals(SocketEvent.Closed(4001, "unauthorized"), events.receive())
            assertFalse(socket.send(ClientMessage.DaemonSettingsGet(id = "r1")))

            socket.open(endpoint, "tok", "Pixel 8")
            assertEquals(SocketEvent.Opened, events.receive())
        }
        collector.cancel()
    }

    private companion object {
        const val TIMEOUT_MS = 5_000L
        const val HELLO =
            """{"type":"hello","protocol":1,"daemon":{"version":"0.1.0","hostname":"MY-LAPTOP",""" +
                """"platform":"win32","tailscaleIp":"100.84.12.9"},""" +
                """"device":{"id":"dev_8f3a","name":"Pixel 8"}}"""
        const val SESSION_IN_UNKNOWN_STATE =
            """{"type":"session.updated","session":{"id":"s_1","name":"n","cwd":"C:\\x",""" +
                """"kind":"claude","state":"sleeping","createdAt":"2026-10-30T13:00:00.000Z",""" +
                """"lastActivityAt":"2026-10-30T13:00:00.000Z"}}"""
    }
}
