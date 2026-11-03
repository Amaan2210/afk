package io.github.amaankhan63.afk.service

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_BAD_ENDPOINT
import io.github.amaankhan63.afk.data.sessions.HELLO
import org.junit.Assert.assertEquals
import org.junit.Test

/** The connection notification's text, whose failures read as the sessions banner's do. */
class ConnectionStatusTextTest {
    @Test fun connectedNamesTheLaptop() {
        assertEquals(
            "Connected to MY-LAPTOP",
            connectionStatusText(ConnectionState.Connected(HELLO), "100.84.12.9")
        )
    }

    /** A pairing exists while the service runs, so a stopped manager is about to connect. */
    @Test fun connectingAndDisconnectedBothReadConnecting() {
        assertEquals("Connecting…", connectionStatusText(ConnectionState.Connecting(2), null))
        assertEquals("Connecting…", connectionStatusText(ConnectionState.Disconnected, null))
    }

    @Test fun failuresReadAsTheBannersDo() {
        assertEquals(
            "Connection refused: unauthorized",
            connectionStatusText(ConnectionState.Failed("unauthorized"), "100.84.12.9")
        )
        assertEquals(
            "Can't reach 100.84.12.9",
            connectionStatusText(ConnectionState.Failed(ERROR_BAD_ENDPOINT), "100.84.12.9")
        )
    }
}
