package io.github.amaankhan63.afk.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PalettesTest {
    @Test
    fun graphiteDarkAccentMatchesMockup() =
        assertEquals(Color(0xFF9CC4FF), Palettes.palette(AfkThemeId.Graphite, dark = true).accent)

    @Test
    fun emberLightBackgroundMatchesMockup() =
        assertEquals(Color(0xFFF8F3EC), Palettes.palette(AfkThemeId.Ember, dark = false).bg)

    @Test
    fun auroraHasGradient() = assertEquals(
        listOf(Color(0xFFB9A6FF), Color(0xFF8EF0D6)),
        Palettes.palette(AfkThemeId.Aurora, true).accentGradient
    )

    @Test
    fun auroraLightGradient() = assertEquals(
        listOf(Color(0xFF6D5AE6), Color(0xFF1FB597)),
        Palettes.palette(AfkThemeId.Aurora, false).accentGradient
    )

    @Test
    fun otherThemesHaveNoGradient() =
        listOf(AfkThemeId.Graphite, AfkThemeId.Ember, AfkThemeId.Phosphor).forEach { id ->
            listOf(true, false).forEach { dark ->
                assertNull(Palettes.palette(id, dark).accentGradient)
            }
        }

    @Test
    fun phosphorTerminalIsNearBlack() =
        assertEquals(Color(0xFF040705), Palettes.terminal(AfkThemeId.Phosphor, true).background)

    @Test
    fun terminalForegroundMatchesMockup() =
        assertEquals(Color(0xFF332A24), Palettes.terminal(AfkThemeId.Ember, false).foreground)

    @Test
    fun terminalCursorIsAccent() =
        assertEquals(Color(0xFF3DFF8F), Palettes.terminal(AfkThemeId.Phosphor, true).cursor)

    @Test
    fun ansiDerivedFromPalette() {
        val p = Palettes.palette(AfkThemeId.Graphite, true)
        val ansi = Palettes.terminal(AfkThemeId.Graphite, true).ansi16
        assertEquals(p.bg, ansi[0])
        assertEquals(p.green, ansi[2])
        assertEquals(p.amber, ansi[3])
        assertEquals(p.blue, ansi[4])
        assertEquals(p.codex, ansi[5])
        assertEquals(p.shell, ansi[6])
        assertEquals(p.text, ansi[7])
    }

    @Test
    fun every16ColourTableHas16() =
        AfkThemeId.entries.filter { it != AfkThemeId.Dynamic }.forEach { id ->
            listOf(true, false).forEach { assertEquals(16, Palettes.terminal(id, it).ansi16.size) }
        }

    @Test
    fun dynamicFallsBackBelow31() =
        assertEquals(AfkThemeId.Graphite, Palettes.resolvesDynamic(AfkThemeId.Dynamic, sdk = 30))

    @Test
    fun dynamicStaysFrom31() =
        assertEquals(AfkThemeId.Dynamic, Palettes.resolvesDynamic(AfkThemeId.Dynamic, sdk = 31))

    @Test
    fun nonDynamicIsUnchanged() =
        assertEquals(AfkThemeId.Ember, Palettes.resolvesDynamic(AfkThemeId.Ember, sdk = 28))

    @Test
    fun dynamicPaletteUsesGraphiteTokens() {
        assertEquals(
            Palettes.palette(AfkThemeId.Graphite, true),
            Palettes.palette(AfkThemeId.Dynamic, true)
        )
    }
}
