package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.sessions.PtyFrame
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.COLS
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.ROWS
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.RULE
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.empty
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.typed
import io.github.amaankhan63.afk.ui.session.terminal.TerminalBridge
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Text moved between Claude's input box and the Chat box. The screen is the real emulator, drawn
 * as Claude draws it; Backspaces show as ⌫. Nothing echoes: each test draws what Claude would.
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceTimeBy, runCurrent
@RunWith(RobolectricTestRunner::class)
class TabCarryTest {
    private val repo = FakeSessionsRepository()
    private val sent = mutableListOf<ByteArray>()
    private var composer = ""
    private var canType = true

    private val typedKeys: String
        get() = sent.joinToString("") { String(it) }.replace('\u007f', '⌫')

    private fun TestScope.carry(): TabCarry {
        repo.connection.value = ConnectionState.Connected(HELLO)
        val bridge = TerminalBridge(repo, "s_1", backgroundScope)
        bridge.attach(COLS, ROWS)
        runCurrent()
        return TabCarry(
            bridge = bridge,
            scope = backgroundScope,
            canType = { canType },
            type = { sent += it },
            composer = { composer },
            setComposer = { composer = it },
            // Long after the last key: the screen is read at once.
            now = { 1_000_000L }
        )
    }

    private fun TestScope.draw(bytes: ByteArray) {
        repo.ptyFrames("s_1").tryEmit(PtyFrame.Data(bytes))
        runCurrent()
    }

    /** Long enough for the screen to settle after a change. */
    private fun TestScope.settle() = advanceTimeBy(CARRY_STABLE_MS * 3)

    @Test fun theTypedTextMovesToChatOnceClaudeHasErasedIt() = runTest {
        val carry = carry()
        draw(typed("hello there"))

        carry.toChat()
        runCurrent()
        assertEquals("⌫".repeat(11), typedKeys)
        assertEquals("", composer)

        draw(empty())
        settle()
        assertEquals("hello there", composer)
    }

    @Test fun aRedrawOfTheSameTextIsNotTakenForTheErase() = runTest {
        val carry = carry()
        draw(typed("hello there"))
        carry.toChat()
        runCurrent()
        // Claude hides the cursor while it redraws, then shows the same box again.
        draw("\u001b[?25l".toByteArray())
        advanceTimeBy(CARRY_POLL_MS * 2)
        draw("\u001b[?25h".toByteArray())
        settle()
        assertEquals("⌫".repeat(11), typedKeys)
        assertEquals("", composer)

        draw(empty())
        settle()
        assertEquals("hello there", composer)
    }

    @Test fun aLongTextShownInPartIsMovedPartByPart() = runTest {
        val carry = carry()
        // Only the last row shows; the one before ends in the space Claude wrapped at.
        draw(typed("world"))
        carry.toChat()
        runCurrent()
        draw(ClaudeScreens.screen(listOf(RULE, "❯ hello", RULE), row = 1, col = 8))
        settle()
        draw(empty())
        settle()

        assertEquals("hello world", composer)
        assertEquals("⌫".repeat(5 + 6), typedKeys)
    }

    @Test fun textNeverErasedStaysOnTheLaptopOnly() = runTest {
        val carry = carry()
        draw(typed("hello"))
        carry.toChat()
        advanceTimeBy(CARRY_ERASE_TIMEOUT_MS + CARRY_POLL_MS * 2)
        assertEquals("", composer)
    }

    @Test fun movedTextGoesAfterWhatChatHolds() = runTest {
        composer = "first"
        val carry = carry()
        draw(typed("then this"))
        carry.toChat()
        runCurrent()
        draw(empty())
        settle()
        assertEquals("first then this", composer)
    }

    @Test fun goingBackMidwayKeepsWhatWasAlreadyErased() = runTest {
        val carry = carry()
        draw(typed("hello"))
        carry.toChat()
        runCurrent()
        // Back to the terminal before the screen shows the box erased.
        carry.toTerminal()
        runCurrent()
        assertEquals("hello", composer)
        assertEquals("⌫⌫⌫⌫⌫", typedKeys)
    }

    @Test fun nothingMovesWhenTypingWouldNotReachTheBox() = runTest {
        canType = false
        val carry = carry()
        draw(typed("hello"))
        carry.toChat()
        settle()
        draw(empty())
        composer = "from chat"
        carry.toTerminal()
        runCurrent()
        assertEquals("", typedKeys)
        assertEquals("from chat", composer)
    }

    @Test fun chatTextIsPastedIntoAnEmptyBoxWithoutEnter() = runTest {
        val carry = carry()
        draw(empty())
        composer = "fix the\r\nbug"
        carry.toTerminal()
        assertEquals("\u001b[200~fix the\nbug\u001b[201~", typedKeys)
        assertEquals("", composer)
    }

    @Test fun chatTextStaysWhenTheBoxHoldsText() = runTest {
        val carry = carry()
        draw(typed("typed on the laptop"))
        composer = "from chat"
        carry.toTerminal()
        assertEquals("", typedKeys)
        assertEquals("from chat", composer)
    }

    @Test fun chatTextClaudeWouldShowInShortStaysInChat() = runTest {
        val carry = carry()
        draw(empty())
        composer = "a\nb\nc\nd"
        carry.toTerminal()
        composer = "x".repeat(MAX_CARRIED_CHARS + 1)
        carry.toTerminal()
        assertEquals("", typedKeys)
    }
}
