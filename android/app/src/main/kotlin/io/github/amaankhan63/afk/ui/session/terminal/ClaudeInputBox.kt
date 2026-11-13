package io.github.amaankhan63.afk.ui.session.terminal

import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TextStyle
import com.termux.terminal.WcWidth

/** Claude Code's prompt mark, which starts its input box's first row. */
private const val PROMPT_MARK = '❯'

/** Where the text starts on every row of the box: after the mark and a space, or two spaces. */
private const val INDENT = 2

/** The columns a row of the box leaves unused: the indent, and two on the right. */
private const val UNUSED_COLUMNS = 4

/** The line Claude Code draws above and below its input box. */
private const val RULE = '─'

/** What Claude Code shows in place of a paste or an image: moved, what it stands for is lost. */
private val STAND_INS = listOf("[Pasted text #", "[Image #")

/** A row's last word at least this long that reaches the edge was cut in two, not wrapped. */
private const val LONG_WORD = 15

/** How far up from the cursor the box's first row is looked for. */
private const val MAX_BOX_ROWS = 60

/** What Claude Code's input box holds, read off the screen. */
internal sealed interface ClaudeInput {
    /** Nothing typed: the box is blank, or shows Claude's dimmed hint. */
    data object Empty : ClaudeInput

    /**
     * [text] is typed, and the cursor is after it. [backspaces] erase it, or a few more: a row
     * that ends at the edge may have lost a space there.
     */
    data class Typed(val text: String, val backspaces: Int) : ClaudeInput
}

/**
 * Claude Code's input box as this screen shows it, from Claude Code 2.1's layout: a rule, rows
 * whose first starts with `❯ ` and the others with two spaces, the terminal's cursor in the last
 * of them, and a rule. Null when the screen does not show the box that way, when the cursor is not
 * after the text (Backspace erases before it), or when the box holds a paste or an image Claude
 * shows in short.
 *
 * Only the rows on the screen are read. A long text shows only its last rows, which then start
 * with `❯ ` too: erasing them shows the rows before.
 */
internal fun TerminalEmulator.claudeInput(): ClaudeInput? {
    if (!isCursorEnabled) return null
    val box = BoxRows(this)
    val last = cursorRow
    val col = cursorCol
    var first = last
    while (first > 0 && last - first < MAX_BOX_ROWS && !box.isPromptRow(first)) {
        if (!box.text(first).let { it.isEmpty() || it.startsWith("  ") }) return null
        first--
    }
    if (!box.isPromptRow(first) || !box.isRule(first - 1) || !box.isRule(last + 1)) return null
    val afterCursor = box.text(last, from = col)
    if (first == last && col == INDENT) {
        val effect = TextStyle.decodeEffect(screen.getStyleAt(last, INDENT))
        val dimmed = (effect and TextStyle.CHARACTER_ATTRIBUTE_DIM) != 0
        return if (afterCursor.isEmpty() || dimmed) ClaudeInput.Empty else null
    }
    if (afterCursor.isNotEmpty() || col < INDENT) return null
    val rows = (first..last).map { row ->
        if (row < last) box.text(row).drop(INDENT) else box.beforeCursor(row, col).drop(INDENT)
    }
    val text = StringBuilder(rows.first())
    var unsure = 0
    for (i in 1 until rows.size) {
        when (rowBreak(rows[i - 1], rows[i], mColumns - UNUSED_COLUMNS)) {
            RowBreak.Wrap -> text.append(' ')
            RowBreak.NewLine -> text.append('\n')
            RowBreak.Cut -> unsure++
        }
        text.append(rows[i])
    }
    val typed = text.toString()
    if (typed.isBlank() || STAND_INS.any { it in typed }) return null
    return ClaudeInput.Typed(typed, typed.codePointCount(0, typed.length) + unsure)
}

private enum class RowBreak { Wrap, NewLine, Cut }

/**
 * What ends row [above], followed by [below], in a box [width] columns wide. Claude wraps at
 * spaces and drops the space it wraps at; a word wider than the row it cuts.
 */
private fun rowBreak(above: String, below: String, width: Int): RowBreak {
    val used = columns(above)
    val lastWord = above.substringAfterLast(' ')
    if (used >= width && lastWord.length >= LONG_WORD) return RowBreak.Cut
    // The first word below would have fitted above: the line ended there.
    val firstWord = below.substringBefore(' ')
    return if (used + 1 + columns(firstWord) <= width) RowBreak.NewLine else RowBreak.Wrap
}

private fun columns(text: String): Int {
    var width = 0
    var i = 0
    while (i < text.length) {
        val codePoint = text.codePointAt(i)
        width += WcWidth.width(codePoint).coerceAtLeast(0)
        i += Character.charCount(codePoint)
    }
    return width
}

/** The screen's rows as text, for [claudeInput]. */
private class BoxRows(private val emulator: TerminalEmulator) {
    private val screen = emulator.screen
    private val cols = emulator.mColumns
    private val rows = emulator.mRows

    /** Row [row] from column [from] on, without trailing spaces; empty off the screen. */
    fun text(row: Int, from: Int = 0): String {
        if (row !in 0 until rows || from >= cols) return ""
        return screen.getSelectedText(from, row, cols - 1, row).trimEnd()
    }

    /** Row [row] up to column [col], keeping the spaces typed before the cursor. */
    fun beforeCursor(row: Int, col: Int): String {
        if (col <= 0) return ""
        val shown = screen.getSelectedText(0, row, col - 1, row).trimEnd()
        return shown + " ".repeat((col - columns(shown)).coerceAtLeast(0))
    }

    fun isPromptRow(row: Int): Boolean {
        val text = text(row)
        return text.firstOrNull() == PROMPT_MARK && (text.length == 1 || text[1] == ' ')
    }

    fun isRule(row: Int): Boolean {
        val text = text(row)
        return text.length >= cols / 2 && text.all { it == RULE }
    }
}
