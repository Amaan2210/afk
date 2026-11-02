package io.github.amaankhan63.afk.data.connection

import kotlin.random.Random
import org.junit.Assert.assertTrue
import org.junit.Test

class BackoffTest {
    @Test fun firstDelayAtMostOneSecond() =
        assertTrue(Backoff(random = Random(1)).delayMs(0) in 500..1000)

    @Test fun neverExceedsCap() =
        (0..20).forEach { assertTrue(Backoff(random = Random(it)).delayMs(it) <= 60_000) }

    @Test fun growsExponentially() =
        assertTrue(Backoff(random = Random(7)).delayMs(5) > Backoff(random = Random(7)).delayMs(1))

    @Test fun hugeAttemptStaysPositiveAndCapped() =
        assertTrue(Backoff(random = Random(3)).delayMs(1_000) in 30_000..60_000)
}
