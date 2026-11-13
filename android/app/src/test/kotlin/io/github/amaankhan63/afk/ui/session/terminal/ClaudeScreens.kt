package io.github.amaankhan63.afk.ui.session.terminal

/**
 * Screens drawn the way Claude Code 2.1 draws its input box, as captured from a real one at 46
 * columns: a rule, `❯ ` and the text, two spaces before each row after the first, a rule, and the
 * terminal's cursor after the text. Its hint for an empty box is dimmed.
 */
internal object ClaudeScreens {
    const val COLS = 46
    const val ROWS = 12
    val RULE = "─".repeat(COLS)
    private const val ESC = "\u001b"
    private const val DIM = "$ESC[2m"
    private const val NOT_DIM = "$ESC[22m"

    /** [rows] from the top of a cleared screen, then the cursor at [row], [col], from 0. */
    fun screen(rows: List<String>, row: Int, col: Int, cursorShown: Boolean = true): ByteArray =
        buildString {
            append("$ESC[2J")
            rows.forEachIndexed { i, text -> append("$ESC[${i + 1};1H").append(text) }
            append("$ESC[${row + 1};${col + 1}H")
            append(if (cursorShown) "$ESC[?25h" else "$ESC[?25l")
        }.toByteArray()

    /** The box holding [lines], each a row as Claude shows it, the cursor after the last one. */
    fun typed(vararg lines: String): ByteArray {
        val rows = listOf("Claude's last answer", RULE) +
            lines.mapIndexed { i, line -> (if (i == 0) "❯ " else "  ") + line } +
            listOf(RULE, "  ⏵⏵ auto mode on (shift+tab to cycle)")
        val last = 1 + lines.size
        return screen(rows, last, 2 + lines.last().length)
    }

    /** The empty box with Claude's dimmed hint, the cursor before it. */
    fun empty(): ByteArray = screen(
        listOf(
            "Claude's last answer",
            RULE,
            "❯ ${DIM}Try \"how does <filepath> work?\"$NOT_DIM",
            RULE,
            "  ⏵⏵ auto mode on (shift+tab to cycle)"
        ),
        row = 2,
        col = 2
    )
}
