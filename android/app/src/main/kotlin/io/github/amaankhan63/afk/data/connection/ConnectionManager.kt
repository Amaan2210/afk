package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/** [AfkError] code of a request made while not connected, or whose connection ended first. */
const val ERROR_DISCONNECTED = "disconnected"

/** [ConnectionState.Failed] code for an endpoint no socket can be opened to, such as a bad host. */
const val ERROR_BAD_ENDPOINT = "bad_endpoint"

/** [ConnectionState.Failed] code of a token the daemon no longer accepts: the phone is unpaired. */
const val ERROR_UNAUTHORIZED = "unauthorized"

/** Keeps one authenticated connection to the daemon and matches replies to requests. */
interface ConnectionManager {
    val state: StateFlow<ConnectionState>

    /** Every frame the daemon sends, replies and id-less `error` notices included. */
    val incoming: SharedFlow<ServerMessage>

    /**
     * Connects with [token] and reconnects until [stop], a rejection, or an endpoint no socket
     * can be opened to ([ERROR_BAD_ENDPOINT]); replaces a running connection.
     */
    fun start(endpoint: Endpoint, token: String)

    /** Closes the connection and stops reconnecting; leaves [ConnectionState.Disconnected]. */
    fun stop()

    /**
     * Sends [msg] under a fresh id, which replaces the `id` it carries, and returns the `ack`,
     * `error`, `fs.dirs` or `daemon.settings` that answers it.
     *
     * Throws [AfkError] when not connected or the connection ends first ([ERROR_DISCONNECTED]), or
     * when the daemon rejects this client; [IllegalArgumentException] for a message the daemon does
     * not answer; and `TimeoutCancellationException` when no reply comes within [timeoutMs].
     */
    suspend fun request(msg: ClientMessage, timeoutMs: Long = 10_000): ServerMessage

    /** Sends a message that gets no reply; it is dropped when not connected. */
    fun send(msg: ClientMessage)

    /**
     * A network the phone was on is gone: the connection is dropped and tried again now, rather
     * than when its pings run out, so the app says it is offline at once.
     */
    fun onNetworkLost()

    /** A network is there: a wait before the next try ends now. */
    fun onNetworkAvailable()
}
