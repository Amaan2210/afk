package io.github.amaankhan63.afk.ui.session.terminal

import io.github.amaankhan63.afk.ui.session.KeyBarKey
import io.github.amaankhan63.afk.ui.session.KeyBarState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pinch: TerminalView passes the scale gathered so far and keeps whatever onScale returns. */
class TerminalHostClientTest {
    private var fontSizeSp = 14
    private val changes = mutableListOf<Int>()
    private val client = TerminalHostClient({ fontSizeSp }, { changes += it })

    @Test fun smallPinchOnlyGathers() {
        assertEquals(1.05f, client.onScale(1.05f), 0f)
        assertEquals(emptyList<Int>(), changes)
    }

    @Test fun pinchOutGrowsTheFontByOneAndStartsOver() {
        assertEquals(1f, client.onScale(1.2f), 0f)
        assertEquals(listOf(15), changes)
    }

    @Test fun pinchInShrinksTheFontByOne() {
        assertEquals(1f, client.onScale(0.8f), 0f)
        assertEquals(listOf(13), changes)
    }

    @Test fun keyboardSendsKeysAsTyped() = assertTrue(client.isTerminalViewSelected())

    @Test fun armedCtrlReachesTheNextCharacterTypedIntoTheTerminalOnce() {
        val keyBar = KeyBarState()
        val client = TerminalHostClient({ fontSizeSp }, { changes += it }, { keyBar })
        keyBar.press(KeyBarKey.Ctrl)

        // TerminalView also asks on every hardware key event, Shift included: asking keeps it.
        assertTrue(client.readControlKey())
        assertTrue(client.readControlKey())
        // False: TerminalView writes the control character itself.
        assertFalse(client.onCodePoint('c'.code, true, null))

        assertFalse(client.readControlKey())
        assertFalse(keyBar.ctrlArmed)
    }

    @Test fun unarmedCtrlIsNotHeld() = assertFalse(client.readControlKey())

    @Test fun fontSizeStaysWithinBounds() {
        fontSizeSp = MAX_FONT_SP
        client.onScale(1.2f)
        fontSizeSp = MIN_FONT_SP
        client.onScale(0.8f)
        assertEquals(emptyList<Int>(), changes)
    }
}
