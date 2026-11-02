package io.github.amaankhan63.afk.ui.util

import java.util.Locale

private val UNITS = listOf("B", "KB", "MB", "GB", "TB")
private const val GB = 3
private const val STEP = 1024.0

/** [bytes] in 1024-based units: `512 B`, `700 MB`, then one decimal from GB up, `12.6 GB`. */
fun humanBytes(bytes: Long): String {
    var value = bytes.toDouble()
    var unit = 0
    while (value >= STEP && unit < UNITS.lastIndex) {
        value /= STEP
        unit++
    }
    val pattern = if (unit >= GB) "%.1f %s" else "%.0f %s"
    return String.format(Locale.ROOT, pattern, value, UNITS[unit])
}
