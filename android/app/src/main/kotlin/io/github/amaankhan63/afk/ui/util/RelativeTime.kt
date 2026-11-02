package io.github.amaankhan63.afk.ui.util

import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException

private const val MINUTE = 60L
private const val HOUR = 60 * MINUTE
private const val DAY = 24 * HOUR

/**
 * How long before [now] the ISO-8601 instant [iso] was, as [relativeTime] of an instant says it;
 * blank when [iso] is not an instant.
 */
fun relativeTime(iso: String, now: Instant): String {
    val then = try {
        Instant.parse(iso)
    } catch (e: DateTimeParseException) {
        return ""
    }
    return relativeTime(then, now)
}

/** How long before [now] [then] was: `now` under a minute and for the future, then `2m`, `1h`, `3d`. */
fun relativeTime(then: Instant, now: Instant): String {
    val seconds = Duration.between(then, now).seconds
    return when {
        seconds < MINUTE -> "now"
        seconds < HOUR -> "${seconds / MINUTE}m"
        seconds < DAY -> "${seconds / HOUR}h"
        else -> "${seconds / DAY}d"
    }
}
