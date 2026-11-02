package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import java.io.IOException
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/** Records what the manager does with its socket; the test plays the daemon by hand. */
class FakeAfkSocket : AfkSocket {
    private val frames = MutableSharedFlow<ServerMessage>(extraBufferCapacity = Int.MAX_VALUE)
    private val socketEvents = MutableSharedFlow<SocketEvent>(extraBufferCapacity = Int.MAX_VALUE)
    override val incoming: SharedFlow<ServerMessage> = frames
    override val events: SharedFlow<SocketEvent> = socketEvents

    /** The token of every `open`, in order. */
    val opens = mutableListOf<String>()
    val sent = mutableListOf<ClientMessage>()
    var isOpen = false
        private set

    override fun open(endpoint: Endpoint, token: String, clientName: String) {
        opens += token
        isOpen = true
    }

    override fun send(msg: ClientMessage): Boolean {
        if (isOpen) sent += msg
        return isOpen
    }

    override fun close() {
        isOpen = false
    }

    fun receive(msg: ServerMessage) = check(frames.tryEmit(msg))

    fun serverCloses(code: Int = 1000, reason: String = "") {
        isOpen = false
        check(socketEvents.tryEmit(SocketEvent.Closed(code, reason)))
    }

    fun fails() {
        isOpen = false
        check(socketEvents.tryEmit(SocketEvent.Failure(IOException("connection refused"))))
    }
}
