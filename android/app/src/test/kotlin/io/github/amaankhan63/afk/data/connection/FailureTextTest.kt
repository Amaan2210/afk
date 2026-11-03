package io.github.amaankhan63.afk.data.connection

import org.junit.Assert.assertEquals
import org.junit.Test

/** The words for a failed connection, which the banner and the service's notification share. */
class FailureTextTest {
    @Test fun aRejectionNamesTheDaemonsCode() {
        assertEquals("Connection refused: unauthorized", failureText("unauthorized", "MY-LAPTOP"))
        assertEquals(
            "Connection refused: protocol_mismatch",
            failureText("protocol_mismatch", null)
        )
    }

    @Test fun aBadEndpointIsUnreachable() {
        assertEquals("Can't reach 100.84.12.9", failureText(ERROR_BAD_ENDPOINT, "100.84.12.9"))
        assertEquals("Can't reach the laptop", failureText(ERROR_BAD_ENDPOINT, null))
    }
}
