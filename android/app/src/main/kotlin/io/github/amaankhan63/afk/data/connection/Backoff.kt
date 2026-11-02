package io.github.amaankhan63.afk.data.connection

import kotlin.random.Random

/**
 * Reconnect delays: [baseMs] × 2^attempt, capped at [capMs], then scaled by a random factor in
 * [0.5, 1.0) so that clients dropped together do not all retry together.
 */
class Backoff(
    val baseMs: Long = 1_000,
    val capMs: Long = 60_000,
    private val random: Random = Random.Default
) {
    init {
        require(baseMs in 1..capMs) { "need 0 < baseMs <= capMs, got $baseMs and $capMs" }
    }

    fun delayMs(attempt: Int): Long {
        val shift = attempt.coerceIn(0, MAX_SHIFT)
        // Compared before shifting, so a large attempt never overflows into a negative delay.
        val ceiling = if (baseMs > capMs shr shift) capMs else baseMs shl shift
        return (ceiling * (0.5 + random.nextDouble() / 2)).toLong()
    }

    private companion object {
        /** Long shifts wrap at 64; anything past 62 doublings is over any cap anyway. */
        const val MAX_SHIFT = 62
    }
}
