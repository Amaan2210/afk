package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.ServerMessage

sealed interface ConnectionState {
    /** Not started, or stopped. */
    data object Disconnected : ConnectionState

    /** Opening a connection or waiting to retry; [attempt] counts tries since the last `hello`. */
    data class Connecting(val attempt: Int) : ConnectionState

    data class Connected(val hello: ServerMessage.Hello) : ConnectionState

    /** The daemon rejected this client with error [code]; no retries until the next start. */
    data class Failed(val code: String) : ConnectionState
}
