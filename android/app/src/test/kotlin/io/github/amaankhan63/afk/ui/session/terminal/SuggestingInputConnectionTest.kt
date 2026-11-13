package io.github.amaankhan63.afk.ui.session.terminal

import com.termux.view.TerminalView
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.ui.session.KeyBarKey
import io.github.amaankhan63.afk.ui.session.KeyBarState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * What the laptop gets as the keyboard edits the field: each change at once, a replaced word as
 * Backspaces (shown as ⌫) and the new letters. Robolectric: the view and the session are real.
 */
@OptIn(ExperimentalCoroutinesApi::class) // runCurrent
@RunWith(RobolectricTestRunner::class)
class SuggestingInputConnectionTest {
    private val repo = FakeSessionsRepository()
    private val keyBar = KeyBarState()
    private var restarts = 0

    private fun TestScope.link(): SuggestingInputConnection {
        repo.connection.value = ConnectionState.Connected(HELLO)
        val bridge = TerminalBridge(repo, "s_1", backgroundScope)
        bridge.attach(80, 24)
        runCurrent()
        val view = TerminalView(RuntimeEnvironment.getApplication(), null)
        view.setTerminalViewClient(TerminalHostClient({ 12 }, {}, { keyBar }))
        view.attachSession(bridge.session)
        return SuggestingInputConnection(view, { keyBar.ctrlArmed }, { restarts++ })
    }

    private val typed: String
        get() = repo.ptyInputs.joinToString("") { String(it.second) }.replace('\u007f', '⌫')

    @Test fun lettersGoOutAsTheyAreTyped() = runTest {
        val link = link()
        link.setComposingText("h", 1)
        link.setComposingText("he", 1)
        link.setComposingText("hel", 1)
        assertEquals("hel", typed)
        assertEquals(0, restarts)
    }

    @Test fun aPickedSuggestionReplacesOnlyWhatDiffers() = runTest {
        val link = link()
        "helo".indices.forEach { link.setComposingText("helo".take(it + 1), 1) }
        link.commitText("hello ", 1)
        assertEquals("helo⌫lo ", typed)
    }

    @Test fun aCorrectionOfTheLastWordRetypesItsEnd() = runTest {
        val link = link()
        link.commitText("teh ", 1)
        link.setComposingRegion(0, 3)
        link.setComposingText("the", 1)
        // Laptop: "teh " → "t" → "the ".
        assertEquals("teh ⌫⌫⌫he ", typed)
    }

    @Test fun backspaceInTheFieldDeletesOnTheLaptop() = runTest {
        val link = link()
        link.commitText("ab", 1)
        link.deleteSurroundingText(1, 0)
        assertEquals("ab⌫", typed)
    }

    @Test fun backspaceBeyondTheFieldDeletesTextTypedBeforeIt() = runTest {
        val link = link()
        link.commitText("a", 1)
        link.deleteSurroundingText(3, 0)
        assertEquals("a⌫⌫⌫", typed)
    }

    @Test fun enterSendsTheLineAndAsksForAnEmptyField() = runTest {
        val link = link()
        link.commitText("hi", 1)
        link.commitText("\n", 1)
        assertEquals("hi\r", typed)
        assertEquals(1, restarts)

        // Typed before the keyboard moved to the new field: still sent, and asked for once.
        link.commitText("x", 1)
        assertEquals("hi\rx", typed)
        assertEquals(1, restarts)
    }

    @Test fun theKeyboardsActionKeyIsEnter() = runTest {
        val link = link()
        link.performEditorAction(0)
        assertEquals("\r", typed)
        assertEquals(1, restarts)
    }

    @Test fun armedCtrlSendsAControlCharacterOnceAndStartsAgain() = runTest {
        val link = link()
        keyBar.press(KeyBarKey.Ctrl)
        link.commitText("c", 1)
        assertEquals("\u0003", typed)
        assertFalse(keyBar.ctrlArmed)
        assertEquals(1, restarts)
    }
}
