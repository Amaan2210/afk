package io.github.amaankhan63.afk

import org.junit.Assert.assertEquals
import org.junit.Test

class SmokeTest {
    @Test fun applicationIdIsExpected() =
        assertEquals("io.github.amaankhan63.afk", BuildConfig.APPLICATION_ID)
}
