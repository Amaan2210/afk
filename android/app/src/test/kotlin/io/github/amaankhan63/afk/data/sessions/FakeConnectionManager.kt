package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.connection.Endpoint
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withTimeout

/** The id this fake stamps on every request, as the real manager stamps its own. */
const val REQUEST_ID = "r1"

/** Plays the daemon by hand: tests push frames with [receive] and script replies in [onRequest]. */
class FakeConnectionManager : ConnectionManager {
    override val state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    override val incoming = MutableSharedFlow<ServerMessage>(extraBufferCapacity = Int.MAX_VALUE)

    /** Every request, in order, under [REQUEST_ID]. */
    val requests = mutableListOf<ClientMessage>()

    /** Every fire-and-forget message, in order, connected or not. */
    val sent = mutableListOf<ClientMessage>()

    /** Answers a request; it may push frames first, throw, or never return. Acks by default. */
    var onRequest: suspend (ClientMessage) -> ServerMessage = { ServerMessage.Ack(REQUEST_ID) }

    override fun start(endpoint: Endpoint, token: String): Unit =
        error("the repository never starts the connection")

    override fun stop(): Unit = error("the repository never stops the connection")

    override suspend fun request(msg: ClientMessage, timeoutMs: Long): ServerMessage {
        if (state.value !is ConnectionState.Connected) {
            throw AfkError(ERROR_DISCONNECTED, "not connected to the daemon")
        }
        val stamped = msg.stamped()
        requests += stamped
        return withTimeout(timeoutMs) { onRequest(stamped) }
    }

    override fun send(msg: ClientMessage) {
        sent += msg
    }

    fun receive(msg: ServerMessage) = check(incoming.tryEmit(msg))

    fun connect() {
        state.value = ConnectionState.Connected(HELLO)
    }

    fun drop() {
        state.value = ConnectionState.Connecting(1)
    }
}

private fun ClientMessage.stamped(): ClientMessage = when (this) {
    is ClientMessage.SessionCreate -> copy(id = REQUEST_ID)
    is ClientMessage.SessionKill -> copy(id = REQUEST_ID)
    is ClientMessage.SessionResume -> copy(id = REQUEST_ID)
    is ClientMessage.SessionRename -> copy(id = REQUEST_ID)
    is ClientMessage.PtySubscribe -> copy(id = REQUEST_ID)
    is ClientMessage.ChatSubscribe -> copy(id = REQUEST_ID)
    is ClientMessage.PendingAnswer -> copy(id = REQUEST_ID)
    is ClientMessage.FsListDirs -> copy(id = REQUEST_ID)
    is ClientMessage.DaemonSettingsSet -> copy(id = REQUEST_ID)
    else -> error("the repository does not request ${this::class.simpleName}")
}
