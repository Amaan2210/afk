package io.github.amaankhan63.afk.data.connection

/** Where the daemon listens; 2350 is the protocol's default port. */
data class Endpoint(val host: String, val port: Int = 2350) {
    fun wsUrl(): String = "ws://$host:$port/ws"
}
