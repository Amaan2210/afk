package io.github.amaankhan63.afk.ui.session.terminal

/** The bytes a terminal sends for keys a phone keyboard lacks. Each read is a fresh array. */
object TerminalKeys {
    private const val DELETE = 0x7f
    private const val UNIT_SEPARATOR = 0x1f

    // Caret notation: Ctrl+'@' is NUL, Ctrl+'A' is 0x01, … Ctrl+'_' is 0x1f.
    private const val CARET_OFFSET = 0x40
    private const val LOWERCASE_OFFSET = 0x60

    val ESC: ByteArray get() = byteArrayOf(0x1b)
    val TAB: ByteArray get() = byteArrayOf(0x09)
    val ENTER: ByteArray get() = byteArrayOf(0x0d)
    val UP: ByteArray get() = "\u001b[A".toByteArray()
    val DOWN: ByteArray get() = "\u001b[B".toByteArray()
    val RIGHT: ByteArray get() = "\u001b[C".toByteArray()
    val LEFT: ByteArray get() = "\u001b[D".toByteArray()

    /**
     * Ctrl+[c] as the control character a terminal sends: `ctrl('c')` and `ctrl('C')` are 0x03,
     * `ctrl('[')` is ESC. Space is NUL, `?` is DEL and `/` is 0x1f, as in TerminalView; any other
     * character is sent as typed, in UTF-8.
     */
    fun ctrl(c: Char): ByteArray {
        val code = when (c) {
            in 'a'..'z' -> c.code - LOWERCASE_OFFSET
            in '@'..'_' -> c.code - CARET_OFFSET
            ' ' -> 0
            '?' -> DELETE
            '/' -> UNIT_SEPARATOR
            else -> return c.toString().toByteArray()
        }
        return byteArrayOf(code.toByte())
    }
}
