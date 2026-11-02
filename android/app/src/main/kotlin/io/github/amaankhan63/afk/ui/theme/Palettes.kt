package io.github.amaankhan63.afk.ui.theme

import androidx.compose.ui.graphics.Color

/** Colour tokens copied from the design mockup (03-tabs-themes-features.html). */
object Palettes {
    private const val DYNAMIC_MIN_SDK = 31

    private class Entry(val palette: AfkPalette, val termBg: Color, val termFg: Color)

    fun palette(id: AfkThemeId, dark: Boolean): AfkPalette = entry(id, dark).palette

    fun terminal(id: AfkThemeId, dark: Boolean): TerminalColors = entry(id, dark).let {
        TerminalColors.from(it.palette, it.termBg, it.termFg)
    }

    fun resolvesDynamic(id: AfkThemeId, sdk: Int): AfkThemeId {
        val unsupported = id == AfkThemeId.Dynamic && sdk < DYNAMIC_MIN_SDK
        return if (unsupported) AfkThemeId.Graphite else id
    }

    // Dynamic has no tokens of its own: its AfkPalette is built from Graphite.
    private fun entry(id: AfkThemeId, dark: Boolean): Entry = when (id) {
        AfkThemeId.Graphite, AfkThemeId.Dynamic -> if (dark) GRAPHITE_DARK else GRAPHITE_LIGHT
        AfkThemeId.Ember -> if (dark) EMBER_DARK else EMBER_LIGHT
        AfkThemeId.Aurora -> if (dark) AURORA_DARK else AURORA_LIGHT
        AfkThemeId.Phosphor -> if (dark) PHOSPHOR_DARK else PHOSPHOR_LIGHT
    }

    private val GRAPHITE_DARK =
        Entry(
            AfkPalette(
                bg = Color(0xFF0B0D12),
                surface = Color(0xFF12151C),
                surface2 = Color(0xFF1A1E27),
                border = Color(0xFF222733),
                text = Color(0xFFE6E8EE),
                text2 = Color(0xFF8F96A3),
                accent = Color(0xFF9CC4FF),
                onAccent = Color(0xFF0B1A33),
                accentSoft = Color(0xFF1D2A44),
                amber = Color(0xFFF5B94A),
                blue = Color(0xFF5AA9FF),
                green = Color(0xFF4FD38A),
                claude = Color(0xFFE3A57E),
                codex = Color(0xFFB4A7FF),
                shell = Color(0xFF7FD1E6)
            ),
            termBg = Color(0xFF0B0D12),
            termFg = Color(0xFFD4D8E0)
        )

    private val GRAPHITE_LIGHT =
        Entry(
            AfkPalette(
                bg = Color(0xFFF2F3F6),
                surface = Color(0xFFFFFFFF),
                surface2 = Color(0xFFE9EBF0),
                border = Color(0xFFDCDFE6),
                text = Color(0xFF171A21),
                text2 = Color(0xFF697180),
                accent = Color(0xFF2F6FED),
                onAccent = Color(0xFFFFFFFF),
                accentSoft = Color(0xFFE3ECFF),
                amber = Color(0xFFC98A12),
                blue = Color(0xFF2F6FED),
                green = Color(0xFF1F9D5A),
                claude = Color(0xFFC2622F),
                codex = Color(0xFF6A52E6),
                shell = Color(0xFF1686A3)
            ),
            termBg = Color(0xFFFFFFFF),
            termFg = Color(0xFF2A2F3A)
        )

    private val EMBER_DARK =
        Entry(
            AfkPalette(
                bg = Color(0xFF120F0D),
                surface = Color(0xFF1B1613),
                surface2 = Color(0xFF241E1A),
                border = Color(0xFF2E2622),
                text = Color(0xFFF3EBE3),
                text2 = Color(0xFFA3978C),
                accent = Color(0xFFE8A06C),
                onAccent = Color(0xFF2A160A),
                accentSoft = Color(0xFF3A2718),
                amber = Color(0xFFF2B955),
                blue = Color(0xFF8FB7FF),
                green = Color(0xFF6FD39A),
                claude = Color(0xFFF0B48C),
                codex = Color(0xFFC5B4FF),
                shell = Color(0xFF86D0C0)
            ),
            termBg = Color(0xFF120F0D),
            termFg = Color(0xFFE9DFD4)
        )

    private val EMBER_LIGHT =
        Entry(
            AfkPalette(
                bg = Color(0xFFF8F3EC),
                surface = Color(0xFFFFFDF9),
                surface2 = Color(0xFFF1E9DF),
                border = Color(0xFFE3D8CB),
                text = Color(0xFF2A211B),
                text2 = Color(0xFF7D6F63),
                accent = Color(0xFFC8622F),
                onAccent = Color(0xFFFFFFFF),
                accentSoft = Color(0xFFF6E2D5),
                amber = Color(0xFFB8800F),
                blue = Color(0xFF3A6FD8),
                green = Color(0xFF1F8F5A),
                claude = Color(0xFFBF5A2A),
                codex = Color(0xFF6C54D8),
                shell = Color(0xFF1A8F7F)
            ),
            termBg = Color(0xFFFFFDF9),
            termFg = Color(0xFF332A24)
        )

    private val AURORA_DARK =
        Entry(
            AfkPalette(
                bg = Color(0xFF0A0C18),
                surface = Color(0xFF11142A),
                surface2 = Color(0xFF181C38),
                border = Color(0xFF232848),
                text = Color(0xFFE9EBFF),
                text2 = Color(0xFF8F94BB),
                accent = Color(0xFF8EF0D6),
                onAccent = Color(0xFF062219),
                accentSoft = Color(0xFF1A2F3A),
                amber = Color(0xFFFFC46B),
                blue = Color(0xFF86A9FF),
                green = Color(0xFF5FE0A8),
                claude = Color(0xFFFFB088),
                codex = Color(0xFFB9A6FF),
                shell = Color(0xFF7AD8FF),
                accentGradient = listOf(Color(0xFFB9A6FF), Color(0xFF8EF0D6))
            ),
            termBg = Color(0xFF0A0C18),
            termFg = Color(0xFFD9DCF5)
        )

    private val AURORA_LIGHT =
        Entry(
            AfkPalette(
                bg = Color(0xFFF0F2FB),
                surface = Color(0xFFFFFFFF),
                surface2 = Color(0xFFE7EAF8),
                border = Color(0xFFD8DCF0),
                text = Color(0xFF171A33),
                text2 = Color(0xFF6B7096),
                accent = Color(0xFF4F46E5),
                onAccent = Color(0xFFFFFFFF),
                accentSoft = Color(0xFFE6E4FF),
                amber = Color(0xFFC58A0D),
                blue = Color(0xFF4F46E5),
                green = Color(0xFF179C62),
                claude = Color(0xFFD2652F),
                codex = Color(0xFF6D5AE6),
                shell = Color(0xFF0E8FB8),
                accentGradient = listOf(Color(0xFF6D5AE6), Color(0xFF1FB597))
            ),
            termBg = Color(0xFFFFFFFF),
            termFg = Color(0xFF2A2D4A)
        )

    private val PHOSPHOR_DARK =
        Entry(
            AfkPalette(
                bg = Color(0xFF040705),
                surface = Color(0xFF0A120C),
                surface2 = Color(0xFF0F1A12),
                border = Color(0xFF15261A),
                text = Color(0xFFD8F3DF),
                text2 = Color(0xFF6F9C7C),
                accent = Color(0xFF3DFF8F),
                onAccent = Color(0xFF04200F),
                accentSoft = Color(0xFF0F3A20),
                amber = Color(0xFFFFD166),
                blue = Color(0xFF62B6FF),
                green = Color(0xFF3DFF8F),
                claude = Color(0xFFFFB86B),
                codex = Color(0xFFC3A6FF),
                shell = Color(0xFF62E0FF)
            ),
            termBg = Color(0xFF040705),
            termFg = Color(0xFFC8ECCF)
        )

    private val PHOSPHOR_LIGHT =
        Entry(
            AfkPalette(
                bg = Color(0xFFEEF3EE),
                surface = Color(0xFFFFFFFF),
                surface2 = Color(0xFFE2EBE3),
                border = Color(0xFFCFDCD2),
                text = Color(0xFF10251A),
                text2 = Color(0xFF577462),
                accent = Color(0xFF0F9D58),
                onAccent = Color(0xFFFFFFFF),
                accentSoft = Color(0xFFD9F1E3),
                amber = Color(0xFFB07A00),
                blue = Color(0xFF1F6FD0),
                green = Color(0xFF0F9D58),
                claude = Color(0xFFCC6B1F),
                codex = Color(0xFF6F4FD9),
                shell = Color(0xFF0C8FB0)
            ),
            termBg = Color(0xFFFFFFFF),
            termFg = Color(0xFF1D3326)
        )
}
