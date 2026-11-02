package io.github.amaankhan63.afk.ui.util

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class RelativeTimeTest {
    private val now = Instant.parse("2026-10-30T10:02:10Z")

    @Test fun twoMinutes() = assertEquals(
        "2m",
        relativeTime("2026-10-30T10:00:00Z", Instant.parse("2026-10-30T10:02:10Z"))
    )

    @Test fun underAMinuteIsNow() {
        assertEquals("now", relativeTime("2026-10-30T10:02:10Z", now))
        assertEquals("now", relativeTime("2026-10-30T10:01:11Z", now))
    }

    @Test fun futureIsNow() = assertEquals("now", relativeTime("2026-10-30T10:05:00Z", now))

    @Test fun minutesHoursAndDays() {
        assertEquals("1m", relativeTime("2026-10-30T10:01:10Z", now))
        assertEquals("59m", relativeTime("2026-10-30T09:02:11Z", now))
        assertEquals("1h", relativeTime("2026-10-30T09:02:10Z", now))
        assertEquals("23h", relativeTime("2026-10-29T10:02:11Z", now))
        assertEquals("1d", relativeTime("2026-10-29T10:02:10Z", now))
        assertEquals("3d", relativeTime("2026-10-27T08:00:00Z", now))
    }

    @Test fun readsMillisecondStamps() = assertEquals(
        "2m",
        relativeTime("2026-10-30T10:00:00.000Z", now)
    )

    @Test fun takesInstants() = assertEquals("14m", relativeTime(now.minusSeconds(14 * 60), now))

    @Test fun unreadableStampIsBlank() = assertEquals("", relativeTime("yesterday", now))
}
