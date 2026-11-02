package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.ui.session.terminal.TerminalKeys
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyBarStateTest {
    @Test fun ctrlIsStickyForOneKey() {
        val k = KeyBarState()
        assertNull(k.press(KeyBarKey.Ctrl))
        assertArrayEquals(byteArrayOf(0x03), k.press('c'))
        assertFalse(k.ctrlArmed)
    }

    @Test fun keysSendTheirSequences() {
        val k = KeyBarState()
        assertArrayEquals(TerminalKeys.ESC, k.press(KeyBarKey.Esc))
        assertArrayEquals(TerminalKeys.TAB, k.press(KeyBarKey.Tab))
        assertArrayEquals(TerminalKeys.UP, k.press(KeyBarKey.Up))
        assertArrayEquals(TerminalKeys.DOWN, k.press(KeyBarKey.Down))
        assertArrayEquals(TerminalKeys.LEFT, k.press(KeyBarKey.Left))
        assertArrayEquals(TerminalKeys.RIGHT, k.press(KeyBarKey.Right))
        assertArrayEquals(TerminalKeys.ENTER, k.press(KeyBarKey.Enter))
        assertNull(k.press(KeyBarKey.Keyboard))
    }

    @Test fun unarmedCharacterIsLeftToTheComposer() {
        val k = KeyBarState()
        assertNull(k.press('c'))
    }

    @Test fun ctrlPressedTwiceDisarms() {
        val k = KeyBarState()
        k.press(KeyBarKey.Ctrl)
        assertTrue(k.ctrlArmed)
        k.press(KeyBarKey.Ctrl)
        assertFalse(k.ctrlArmed)
    }

    @Test fun anotherKeyUsesUpTheArmedCtrl() {
        val k = KeyBarState()
        k.press(KeyBarKey.Ctrl)
        assertArrayEquals(TerminalKeys.ESC, k.press(KeyBarKey.Esc))
        assertFalse(k.ctrlArmed)
    }

    @Test fun armedCtrlTurnsTheComposersNextCharacterIntoAControlCharacter() {
        val k = KeyBarState()
        assertNull(k.typed("ls", "lsc"))
        k.press(KeyBarKey.Ctrl)
        // A paste is the composer's, and leaves Ctrl armed.
        assertNull(k.typed("", "pasted"))
        assertArrayEquals(byteArrayOf(0x03), k.typed("ls", "lsc"))
        assertFalse(k.ctrlArmed)
    }

    @Test fun insertedCharacterIsFoundAnywhere() {
        assertEquals('c', insertedChar("", "c"))
        assertEquals('x', insertedChar("ab", "axb"))
        assertNull(insertedChar("ab", "abcd"))
        assertNull(insertedChar("abc", "ab"))
        assertNull(insertedChar("ab", "a\nb"))
    }
}
