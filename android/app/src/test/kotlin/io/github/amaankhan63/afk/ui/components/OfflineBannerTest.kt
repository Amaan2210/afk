package io.github.amaankhan63.afk.ui.components

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_BAD_ENDPOINT
import io.github.amaankhan63.afk.data.sessions.HELLO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the banner over the sessions list says in each connection state. */
class OfflineBannerTest {
    @Test fun connectedShowsNoBanner() {
        assertNull(bannerText(ConnectionState.Connected(HELLO), "MY-LAPTOP"))
    }

    @Test fun connectingNamesTheLaptopAndTheAttempt() {
        assertEquals(
            "Reconnecting to MY-LAPTOP… (attempt 3)",
            bannerText(ConnectionState.Connecting(3), "MY-LAPTOP")
        )
    }

    /** The first try after a start is attempt 0: nothing has dropped yet, so it only connects. */
    @Test fun theFirstTryIsAttemptZero() {
        assertEquals(
            "Connecting to 100.84.12.9…",
            bannerText(ConnectionState.Connecting(0), "100.84.12.9")
        )
    }

    @Test fun disconnectedSaysSo() {
        assertEquals("Not connected", bannerText(ConnectionState.Disconnected, "MY-LAPTOP"))
    }

    @Test fun aRejectionNamesTheDaemonsCode() {
        assertEquals(
            "Connection refused: unauthorized",
            bannerText(ConnectionState.Failed("unauthorized"), "MY-LAPTOP")
        )
        assertEquals(
            "Connection refused: protocol_mismatch",
            bannerText(ConnectionState.Failed("protocol_mismatch"), "MY-LAPTOP")
        )
    }

    @Test fun aBadEndpointIsUnreachable() {
        assertEquals(
            "Can't reach 100.84.12.9",
            bannerText(ConnectionState.Failed(ERROR_BAD_ENDPOINT), "100.84.12.9")
        )
    }

    /** Before the pairing is read and before any `hello`, the laptop has no name yet. */
    @Test fun anUnknownHostIsTheLaptop() {
        assertEquals(
            "Reconnecting to the laptop… (attempt 1)",
            bannerText(ConnectionState.Connecting(1), null)
        )
        assertEquals(
            "Can't reach the laptop",
            bannerText(ConnectionState.Failed(ERROR_BAD_ENDPOINT), null)
        )
    }

    /** The name from the latest `hello` wins; the paired address stands in until there is one. */
    @Test fun theBannerNamesTheLaptopByItsHostnameFirst() {
        assertEquals("MY-LAPTOP", bannerHost(hostname = "MY-LAPTOP", pairingHost = "100.84.12.9"))
        assertEquals("100.84.12.9", bannerHost(hostname = null, pairingHost = "100.84.12.9"))
        assertNull(bannerHost(hostname = null, pairingHost = null))
    }

    @Test fun theBannerWaitsForADropOrARefusal() {
        assertFalse(showsBanner(ConnectionState.Disconnected))
        assertFalse(showsBanner(ConnectionState.Connecting(0)))
        assertFalse(showsBanner(ConnectionState.Connected(HELLO)))
        assertTrue(showsBanner(ConnectionState.Connecting(1)))
        assertTrue(showsBanner(ConnectionState.Failed("unauthorized")))
    }
}
