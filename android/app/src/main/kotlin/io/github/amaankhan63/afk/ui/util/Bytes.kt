package io.github.amaankhan63.afk.ui.util

import java.util.Locale
import kotlin.math.pow
import kotlin.math.roundToLong

private val UNITS = listOf("B", "KB", "MB", "GB", "TB")
private const val GB = 3
private const val STEP = 1024.0

/** [bytes] in 1024-based units: `512 B`, `700 MB`, then one decimal from GB up, `12.6 GB`. */
fun humanBytes(bytes: Long): String {
    var value = bytes.toDouble()
    var unit = 0
    // Decided on the value as shown, so 1023.9996 KB reads 1 MB, not 1024 KB.
    while (unit < UNITS.lastIndex && rounded(value, decimals(unit)) >= STEP) {
        value /= STEP
        unit++
    }
    return String.format(Locale.ROOT, "%.${decimals(unit)}f %s", value, UNITS[unit])
}

private fun decimals(unit: Int) = if (unit >= GB) 1 else 0

private fun rounded(value: Double, decimals: Int): Double {
    val scale = 10.0.pow(decimals)
    return (value * scale).roundToLong() / scale
}
