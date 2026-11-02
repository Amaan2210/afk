package io.github.amaankhan63.afk.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp

data class TerminalColors(
    val background: Color,
    val foreground: Color,
    val cursor: Color,
    val ansi16: List<Color>
) {
    companion object {
        private const val BRIGHTEN = 0.25f

        /**
         * Derives the 16 ANSI colours from a palette: black=bg, red=claude (the warm
         * error-ish tone), green, yellow=amber, blue, magenta=codex, cyan=shell, white=text.
         * Entries 8-15 are the same colours lightened toward white.
         */
        fun from(palette: AfkPalette, background: Color, foreground: Color): TerminalColors {
            val normal =
                listOf(
                    palette.bg,
                    palette.claude,
                    palette.green,
                    palette.amber,
                    palette.blue,
                    palette.codex,
                    palette.shell,
                    palette.text
                )
            return TerminalColors(
                background = background,
                foreground = foreground,
                cursor = palette.accent,
                ansi16 = normal + normal.map { lerp(it, Color.White, BRIGHTEN) }
            )
        }
    }
}
