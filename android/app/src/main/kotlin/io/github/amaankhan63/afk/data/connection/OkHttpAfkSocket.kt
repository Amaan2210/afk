package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.AfkJson
import io.github.amaankhan63.afk.data.protocol.ClientInfo
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

/**
 * [AfkSocket] over an OkHttp WebSocket.
 *
 * Buffering: OkHttp's listener thread cannot suspend, so it hands every frame and event to
 * [MutableSharedFlow.tryEmit] on a flow with an unbounded buffer. That never blocks the thread and
 * never drops a value for a subscriber; its limits are that a stalled collector grows memory, and
 * that a value emitted while nobody collects is gone (no replay), so collect before [open].
 */
class OkHttpAfkSocket(private val client: OkHttpClient) : AfkSocket {
    private val frames = MutableSharedFlow<ServerMessage>(extraBufferCapacity = Int.MAX_VALUE)
    private val socketEvents = MutableSharedFlow<SocketEvent>(extraBufferCapacity = Int.MAX_VALUE)
    override val incoming: SharedFlow<ServerMessage> = frames.asSharedFlow()
    override val events: SharedFlow<SocketEvent> = socketEvents.asSharedFlow()

    private val lock = Any()

    /** Bumped by every open and close; older listeners emit nothing. Guarded by [lock]. */
    private var generation = 0L

    @Volatile private var current: WebSocket? = null

    override fun open(endpoint: Endpoint, token: String, clientName: String) {
        val auth = ClientMessage.Auth(token = token, client = ClientInfo(CLIENT_KIND, clientName))
        val request = Request.Builder().url(endpoint.wsUrl()).build()
        synchronized(lock) {
            closeLocked()
            val webSocket = client.newWebSocket(request, Listener(generation))
            // Queued before the socket is published, so no other frame can go out ahead of it.
            webSocket.send(AfkJson.encodeClient(auth))
            current = webSocket
        }
    }

    override fun send(msg: ClientMessage): Boolean =
        current?.send(AfkJson.encodeClient(msg)) ?: false

    override fun close() = synchronized(lock) { closeLocked() }

    private fun closeLocked() {
        generation++
        current?.close(NORMAL_CLOSURE, null)
        current = null
    }

    private inner class Listener(private val ownGeneration: Long) : WebSocketListener() {
        /** Set by the first Closed or Failure: a connection ends once. Guarded by [lock]. */
        private var ended = false

        override fun onOpen(webSocket: WebSocket, response: Response) = emit(SocketEvent.Opened)

        override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = try {
                AfkJson.decodeServer(text)
            } catch (e: IllegalArgumentException) {
                // SerializationException included: not JSON, no `type`, or an unknown value.
                emit(SocketEvent.DecodeFailure(e.message ?: e.javaClass.name))
                return
            }
            synchronized(lock) { if (isLive()) frames.tryEmit(msg) }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) =
            emit(SocketEvent.DecodeFailure("binary frame"))

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(NORMAL_CLOSURE, null) // completes the closing handshake
            emit(SocketEvent.Closed(code, reason))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) =
            emit(SocketEvent.Closed(code, reason))

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            emit(SocketEvent.Failure(t))

        private fun emit(event: SocketEvent) {
            synchronized(lock) {
                if (!isLive()) return
                if (event is SocketEvent.Closed || event is SocketEvent.Failure) ended = true
                socketEvents.tryEmit(event)
            }
        }

        private fun isLive() = ownGeneration == generation && !ended
    }

    private companion object {
        const val CLIENT_KIND = "android"
        const val NORMAL_CLOSURE = 1000
    }
}
