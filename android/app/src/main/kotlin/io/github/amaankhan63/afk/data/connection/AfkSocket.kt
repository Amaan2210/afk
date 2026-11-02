package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import kotlinx.coroutines.flow.SharedFlow

/** A WebSocket to the AFK daemon, one connection at a time. */
interface AfkSocket {
    /** Decoded frames of the current connection, in arrival order. */
    val incoming: SharedFlow<ServerMessage>

    /** The current connection's lifecycle; one [SocketEvent.Closed] or `Failure` ends it. */
    val events: SharedFlow<SocketEvent>

    /** Closes any current connection and opens one to [endpoint]; `auth` is its first frame. */
    fun open(endpoint: Endpoint, token: String, clientName: String)

    /** Queues [msg] on the current connection; false when there is none or it is closing. */
    fun send(msg: ClientMessage): Boolean

    /** Closes the current connection, which emits nothing more. */
    fun close()
}

sealed interface SocketEvent {
    data object Opened : SocketEvent

    data class Closed(val code: Int, val reason: String) : SocketEvent

    data class Failure(val t: Throwable) : SocketEvent

    /** A frame that could not be decoded was dropped; the connection stays open. */
    data class DecodeFailure(val reason: String) : SocketEvent
}
