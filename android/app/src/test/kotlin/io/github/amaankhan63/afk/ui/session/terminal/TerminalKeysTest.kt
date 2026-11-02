package io.github.amaankhan63.afk.ui.session.terminal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalKeysTest {
    @Test fun ctrlC() = assertArrayEquals(byteArrayOf(0x03), TerminalKeys.ctrl('c'))

    @Test fun upIsCsiA() = assertEquals("\u001b[A", String(TerminalKeys.UP))

    @Test fun namedKeys() {
        assertArrayEquals(byteArrayOf(0x1b), TerminalKeys.ESC)
        assertArrayEquals(byteArrayOf(0x09), TerminalKeys.TAB)
        assertArrayEquals(byteArrayOf(0x0d), TerminalKeys.ENTER)
        assertEquals("\u001b[B", String(TerminalKeys.DOWN))
        assertEquals("\u001b[C", String(TerminalKeys.RIGHT))
        assertEquals("\u001b[D", String(TerminalKeys.LEFT))
    }

    @Test fun ctrlBracketIsEscape() = assertArrayEquals(byteArrayOf(0x1b), TerminalKeys.ctrl('['))

    @Test fun ctrlIgnoresCase() = assertArrayEquals(byteArrayOf(0x03), TerminalKeys.ctrl('C'))

    @Test fun ctrlCaretNotation() {
        assertArrayEquals(byteArrayOf(0x00), TerminalKeys.ctrl(' '))
        assertArrayEquals(byteArrayOf(0x00), TerminalKeys.ctrl('@'))
        assertArrayEquals(byteArrayOf(0x1c), TerminalKeys.ctrl('\\'))
        assertArrayEquals(byteArrayOf(0x1f), TerminalKeys.ctrl('/'))
        assertArrayEquals(byteArrayOf(0x7f), TerminalKeys.ctrl('?'))
    }

    @Test fun ctrlLeavesOtherCharactersAsTyped() =
        assertArrayEquals("é".toByteArray(), TerminalKeys.ctrl('é'))

    @Test fun keysCannotBeChangedByCallers() {
        TerminalKeys.ESC[0] = 0
        assertArrayEquals(byteArrayOf(0x1b), TerminalKeys.ESC)
    }
}
