package io.github.amaankhan63.afk.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Test

class ThemeMappingTest {
    private val p = Palettes.palette(AfkThemeId.Graphite, dark = true)
    private val scheme = p.toColorScheme(dark = true)

    @Test
    fun surfaceContainerHighestIsSurface2() =
        assertEquals(p.surface2, scheme.surfaceContainerHighest)

    @Test
    fun secondaryContainerIsAccentSoft() = assertEquals(p.accentSoft, scheme.secondaryContainer)

    @Test
    fun outlineVariantIsBorder() = assertEquals(p.border, scheme.outlineVariant)

    @Test
    fun surfaceTintIsAccent() = assertEquals(p.accent, scheme.surfaceTint)
}
