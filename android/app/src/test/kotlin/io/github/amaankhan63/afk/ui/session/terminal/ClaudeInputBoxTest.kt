package io.github.amaankhan63.afk.ui.session.terminal

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.sessions.PtyFrame
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.COLS
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.ROWS
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.RULE
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.empty
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.screen
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeScreens.typed
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Claude's input box read off the real emulator, from screens drawn as Claude draws them. */
@OptIn(ExperimentalCoroutinesApi::class) // runCurrent
@RunWith(RobolectricTestRunner::class)
class ClaudeInputBoxTest {
    private val repo = FakeSessionsRepository()

    private fun TestScope.read(bytes: ByteArray): ClaudeInput? {
        repo.connection.value = ConnectionState.Connected(HELLO)
        val bridge = TerminalBridge(repo, "s_1", backgroundScope)
        bridge.attach(COLS, ROWS)
        runCurrent()
        repo.ptyFrames("s_1").tryEmit(PtyFrame.Data(bytes))
        runCurrent()
        return bridge.claudeInput()
    }

    @Test fun theDimmedHintIsAnEmptyBox() = runTest {
        assertEquals(ClaudeInput.Empty, read(empty()))
    }

    @Test fun aBlankBoxIsEmpty() = runTest {
        assertEquals(ClaudeInput.Empty, read(screen(listOf(RULE, "❯ ", RULE), row = 1, col = 2)))
    }

    @Test fun oneTypedLine() = runTest {
        assertEquals(ClaudeInput.Typed("hello there", 11), read(typed("hello there")))
    }

    @Test fun spacesTypedBeforeTheCursorAreKept() = runTest {
        val bytes = screen(listOf(RULE, "❯ hello", RULE), row = 1, col = 8)
        assertEquals(ClaudeInput.Typed("hello ", 6), read(bytes))
    }

    @Test fun wrappedRowsGetBackTheSpaceClaudeDroppedAtTheWrap() = runTest {
        // As captured: the first row is full, and "should" did not fit after "that".
        val full = "hello there and this is a longer line that"
        val input = read(typed(full, "should wrap in the box"))
        val text = "$full should wrap in the box"
        assertEquals(ClaudeInput.Typed(text, text.length), input)
    }

    @Test fun aLineBreakIsKept() = runTest {
        assertEquals(ClaudeInput.Typed("one\ntwo", 7), read(typed("one", "two")))
    }

    @Test fun aLongWordCutAtTheEdgeIsJoinedWholeWithOneBackspaceToSpare() = runTest {
        val text = "see https://example.com/" + "a".repeat(30)
        val width = COLS - 4
        val input = read(typed(text.take(width), text.drop(width)))
        assertEquals(ClaudeInput.Typed(text, text.length + 1), input)
    }

    @Test fun nothingWhenTheCursorIsNotAfterTheText() = runTest {
        assertNull(read(screen(listOf(RULE, "❯ hello there", RULE), row = 1, col = 5)))
    }

    @Test fun nothingWhenTheBoxHoldsAPasteShownInShort() = runTest {
        assertNull(read(typed("[Pasted text #1 +3 lines]")))
        assertNull(read(typed("look at [Image #1]")))
    }

    @Test fun nothingOnAnotherScreen() = runTest {
        assertNull(read(screen(listOf("$ ls", "build  src", "$ "), row = 2, col = 2)))
    }

    @Test fun nothingWithoutTheRuleUnderTheBox() = runTest {
        // A list to pick from also marks its row with ❯.
        val bytes = screen(listOf(RULE, "❯ 1. Yes", "  2. No"), row = 1, col = 8)
        assertNull(read(bytes))
    }

    @Test fun nothingWhileTheCursorIsHidden() = runTest {
        val bytes = screen(listOf(RULE, "❯ hello", RULE), row = 1, col = 7, cursorShown = false)
        assertNull(read(bytes))
    }
}
