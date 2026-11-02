package io.github.amaankhan63.afk.ui.session.terminal

import org.junit.Assert.assertEquals
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

    @Test fun fontSizeStaysWithinBounds() {
        fontSizeSp = MAX_FONT_SP
        client.onScale(1.2f)
        fontSizeSp = MIN_FONT_SP
        client.onScale(0.8f)
        assertEquals(emptyList<Int>(), changes)
    }
}
