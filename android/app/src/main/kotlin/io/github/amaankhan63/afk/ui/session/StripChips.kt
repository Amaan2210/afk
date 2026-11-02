package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** What the status strip can show; Settings picks some, and they show in this order. */
enum class StripChip {
    Model,
    Thinking,
    CtxUsed,
    CtxSize,
    Cost,
    FiveHour,
    SevenDay,
    SessionTime,
    Memory,
    TokensInOut
}

val DEFAULT_STRIP_CHIPS = listOf(
    StripChip.Model,
    StripChip.Thinking,
    StripChip.CtxUsed,
    StripChip.Cost,
    StripChip.FiveHour,
    StripChip.SessionTime
)

/** Marks the model's chip, which the strip shows in the accent colour. */
const val MODEL_MARK = "✦"

/** The text of each [StripChip]. */
object StripChips {
    private const val THOUSAND = 1000L
    private const val MS_PER_MINUTE = 60_000L
    private const val MINUTES_PER_HOUR = 60L
    private const val BYTES_PER_GB = 1024.0 * 1024.0 * 1024.0

    /**
     * [chip] as the strip shows it: `ctx 11%`, `$3.60`, `1h 05m`… Every chip but Memory reads
     * [strip]; Memory reads the laptop's [stats]. Null when the value is absent.
     */
    fun render(chip: StripChip, strip: Strip?, stats: Stats?): String? = when (chip) {
        StripChip.Model -> strip?.model?.let { "$MODEL_MARK ${it.name}" }
        StripChip.Thinking -> strip?.thinking
        StripChip.CtxUsed -> strip?.contextUsedPct?.let { "ctx ${percent(it)}" }
        StripChip.CtxSize -> strip?.contextSize?.let { "${count(it)} ctx" }
        StripChip.Cost -> strip?.costUsd?.let { format("$%.2f", it) }
        StripChip.FiveHour -> strip?.fiveHourPct?.let { "5h ${percent(it)}" }
        StripChip.SevenDay -> strip?.sevenDayPct?.let { "7d ${percent(it)}" }
        StripChip.SessionTime -> strip?.durationMs?.let(::duration)
        StripChip.Memory -> stats?.let(::memory)
        StripChip.TokensInOut -> strip?.let(::tokens)
    }

    private fun percent(value: Double) = "${value.roundToInt()}%"

    /** Used and total laptop memory in 1024-based GB, `12.6/13.9 GB`. */
    private fun memory(stats: Stats): String {
        val used = stats.ramUsedBytes / BYTES_PER_GB
        val total = stats.ramTotalBytes / BYTES_PER_GB
        return format("%.1f/%.1f GB", used, total)
    }

    /** `268 in · 32.8k out`; null unless both totals are known. */
    private fun tokens(strip: Strip): String? {
        val tokensIn = strip.tokensIn ?: return null
        val tokensOut = strip.tokensOut ?: return null
        return "${count(tokensIn)} in · ${count(tokensOut)} out"
    }

    /** `268`, then thousands as `32.8k` and millions as `1.2M`. */
    private fun count(n: Long): String {
        if (n < THOUSAND) return n.toString()
        val thousands = n / THOUSAND.toDouble()
        // Decided on the value as shown, so 999,960 reads 1.0M, not 1000.0k.
        return if ((thousands * 10).roundToLong() < THOUSAND * 10) {
            format("%.1fk", thousands)
        } else {
            format("%.1fM", thousands / THOUSAND)
        }
    }

    /** Whole minutes, `32m`, then hours and minutes from an hour up, `1h 05m`. */
    private fun duration(ms: Long): String {
        val minutes = ms / MS_PER_MINUTE
        if (minutes < MINUTES_PER_HOUR) return "${minutes}m"
        return format("%dh %02dm", minutes / MINUTES_PER_HOUR, minutes % MINUTES_PER_HOUR)
    }

    private fun format(pattern: String, vararg args: Any) =
        String.format(Locale.ROOT, pattern, *args)
}
