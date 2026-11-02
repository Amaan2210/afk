package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.protocol.ModelInfo
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StripChipsTest {
    private val full = Strip(
        at = "t",
        model = ModelInfo("fable-5-1", "Fable 5.1"),
        thinking = "xhigh",
        contextUsedPct = 11.0,
        contextSize = 109_500,
        costUsd = 3.6,
        durationMs = 32 * 60_000L + 59_000,
        fiveHourPct = 37.6,
        sevenDayPct = 12.0,
        tokensIn = 268,
        tokensOut = 32_800
    )

    private fun render(chip: StripChip, strip: Strip? = full) = StripChips.render(chip, strip, null)

    @Test fun rendersCostAndCtx() {
        val s = Strip(at = "t", costUsd = 3.6, contextUsedPct = 11.0)
        assertEquals("$3.60", StripChips.render(StripChip.Cost, s, null))
        assertEquals("ctx 11%", StripChips.render(StripChip.CtxUsed, s, null))
    }

    @Test fun memoryComesFromStats() = assertEquals(
        "12.6/13.9 GB",
        StripChips.render(
            StripChip.Memory,
            null,
            Stats("t", 13_529_146_982, 14_924_902_400, 34.0, true)
        )
    )

    @Test fun absentValueIsNull() =
        assertNull(StripChips.render(StripChip.SevenDay, Strip(at = "t"), null))

    @Test fun rendersEveryStripChip() {
        assertEquals("✦ Fable 5.1", render(StripChip.Model))
        assertEquals("xhigh", render(StripChip.Thinking))
        assertEquals("109.5k ctx", render(StripChip.CtxSize))
        assertEquals("5h 38%", render(StripChip.FiveHour))
        assertEquals("7d 12%", render(StripChip.SevenDay))
        assertEquals("32m", render(StripChip.SessionTime))
        assertEquals("268 in · 32.8k out", render(StripChip.TokensInOut))
    }

    @Test fun sessionTimeShowsHoursAboveAnHour() {
        val strip = Strip(at = "t", durationMs = 65 * 60_000L)
        assertEquals("1h 05m", render(StripChip.SessionTime, strip))
    }

    @Test fun millionsOfTokensReadAsM() {
        val strip = Strip(at = "t", contextSize = 1_000_000, tokensIn = 999_960, tokensOut = 999)
        assertEquals("1.0M ctx", render(StripChip.CtxSize, strip))
        assertEquals("1.0M in · 999 out", render(StripChip.TokensInOut, strip))
    }

    @Test fun everyStripChipIsNullWithoutAStrip() {
        val fromStrip = StripChip.entries - StripChip.Memory
        fromStrip.forEach { assertNull(it.name, render(it, strip = null)) }
        assertNull(render(StripChip.Memory))
    }
}
