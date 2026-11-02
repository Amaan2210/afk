package io.github.amaankhan63.afk.ui.session.terminal

import com.termux.terminal.TerminalEmulator
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.sessions.PtyFrame
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric: Termux's session makes a main-thread Handler. The emulator is the real one. */
@OptIn(ExperimentalCoroutinesApi::class) // advanceTimeBy, advanceUntilIdle, runCurrent
@RunWith(RobolectricTestRunner::class)
class TerminalBridgeTest {
    private val repo = FakeSessionsRepository()
    private val frames = repo.ptyFrames("s_1")

    /** A bridge attached at 80 × 24 while connected, its subscription made. */
    private fun TestScope.attached(): TerminalBridge {
        repo.connection.value = ConnectionState.Connected(HELLO)
        val bridge = TerminalBridge(repo, "s_1", backgroundScope)
        bridge.attach(80, 24)
        runCurrent()
        return bridge
    }

    private fun TestScope.receive(frame: PtyFrame) {
        frames.tryEmit(frame)
        runCurrent()
    }

    private val TerminalBridge.emulator: TerminalEmulator
        get() = checkNotNull(session.emulator) { "no emulator" }

    /** The screen and its scrollback. */
    private val TerminalBridge.text: String get() = emulator.screen.transcriptText

    private val TerminalBridge.grid: Pair<Int, Int> get() = emulator.mColumns to emulator.mRows

    @Test fun snapshotResetsThenFeeds() = runTest {
        val bridge = attached()
        // Enough lines to push "stale" off the screen into the scrollback.
        receive(PtyFrame.Data(("stale\r\n" + "\r\n".repeat(30)).toByteArray()))
        assertTrue(bridge.text.contains("stale"))

        receive(PtyFrame.Snapshot(80, 24, "fresh\r\n> ".toByteArray()))

        assertTrue(bridge.text.contains("fresh"))
        assertFalse(bridge.text.contains("stale"))
    }

    @Test fun snapshotLeavesTheAlternateScreen() = runTest {
        val bridge = attached()
        receive(PtyFrame.Data("\u001b[?1049hfull-screen app".toByteArray()))

        receive(PtyFrame.Snapshot(80, 24, "fresh".toByteArray()))

        assertFalse(bridge.emulator.isAlternateBufferActive)
        assertEquals("fresh", bridge.text.trim())
    }

    @Test fun inputBytesForwarded() = runTest {
        val bridge = attached()
        bridge.session.write("ls".toByteArray(), 0, 2)
        // Each code point goes through one reused buffer, so every write must be copied.
        bridge.session.writeCodePoint(false, 'a'.code)
        bridge.session.writeCodePoint(false, 'b'.code)

        val sent = repo.ptyInputs.map { (id, bytes) -> id to String(bytes) }
        assertEquals(listOf("s_1" to "ls", "s_1" to "a", "s_1" to "b"), sent)
    }

    @Test fun resizeDebouncedToOne() = runTest {
        val bridge = attached()
        bridge.onSizeChanged(80, 24)
        advanceTimeBy(50)
        bridge.onSizeChanged(81, 24)
        advanceTimeBy(200)
        assertEquals(listOf(Triple("s_1", 81, 24)), repo.ptyResizes)
    }

    @Test fun viewLayoutResizesAtOnceAndSendsOnce() = runTest {
        val bridge = attached()
        // TerminalView reports its grid through the session on every layout.
        bridge.session.updateSize(60, 20, 10, 20)
        assertEquals(60 to 20, bridge.grid)
        bridge.session.updateSize(61, 20, 10, 20)

        advanceTimeBy(200)

        assertEquals(listOf(Triple("s_1", 61, 20)), repo.ptyResizes)
    }

    @Test fun remoteSizesAreAppliedWithoutEcho() = runTest {
        val bridge = attached()
        receive(PtyFrame.Snapshot(100, 30, ByteArray(0)))
        assertEquals(100 to 30, bridge.grid)

        receive(PtyFrame.Resized(120, 40))
        assertEquals(120 to 40, bridge.grid)

        advanceUntilIdle()
        assertEquals(emptyList<Triple<String, Int, Int>>(), repo.ptyResizes)
    }

    @Test fun sentSizeWinsOverASnapshotThatCameFirst() = runTest {
        val bridge = attached()
        bridge.session.updateSize(60, 20, 10, 20)
        // The answer to the 80 × 24 subscription lands before the debounced resize goes out.
        receive(PtyFrame.Snapshot(80, 24, "screen".toByteArray()))
        assertEquals(80 to 24, bridge.grid)

        advanceTimeBy(200)

        assertEquals(listOf(Triple("s_1", 60, 20)), repo.ptyResizes)
        assertEquals(60 to 20, bridge.grid)
    }

    @Test fun localSizeChangeAfterARemoteResizeIsSent() = runTest {
        val bridge = attached()
        receive(PtyFrame.Resized(120, 40))

        bridge.session.updateSize(60, 20, 10, 20)
        advanceTimeBy(200)

        assertEquals(listOf(Triple("s_1", 60, 20)), repo.ptyResizes)
        assertEquals(60 to 20, bridge.grid)
    }

    @Test fun noResizeIsSentAfterDetachAndTheGridIsKept() = runTest {
        val bridge = attached()
        bridge.detach()

        bridge.session.updateSize(90, 30, 10, 20)
        advanceTimeBy(200)
        assertEquals(emptyList<Triple<String, Int, Int>>(), repo.ptyResizes)

        bridge.attach(80, 24)
        runCurrent()
        assertEquals(Triple("s_1", 90, 30), repo.ptySubscriptions.last())
    }

    @Test fun reattachSubscribesAtTheViewsGrid() = runTest {
        val bridge = attached()
        bridge.session.updateSize(100, 40, 10, 20)
        advanceTimeBy(200)
        bridge.detach()

        bridge.attach(80, 24)
        runCurrent()

        assertEquals(Triple("s_1", 100, 40), repo.ptySubscriptions.last())
        assertEquals(100 to 40, bridge.grid)
    }

    @Test fun reclaimGridSendsTheViewsGridAfterARemoteResize() = runTest {
        val bridge = attached()
        bridge.session.updateSize(120, 40, 10, 20)
        advanceTimeBy(200)
        repo.ptyResizes.clear()
        // The laptop resized the terminal while the phone showed another tab.
        receive(PtyFrame.Resized(100, 40))

        bridge.reclaimGrid()

        assertEquals(listOf(Triple("s_1", 120, 40)), repo.ptyResizes)
        assertEquals(120 to 40, bridge.grid)
    }

    @Test fun reclaimGridSendsNothingWhenTheGridsAgree() = runTest {
        val bridge = attached()
        bridge.session.updateSize(120, 40, 10, 20)
        advanceTimeBy(200)
        repo.ptyResizes.clear()

        bridge.reclaimGrid()

        assertEquals(emptyList<Triple<String, Int, Int>>(), repo.ptyResizes)
    }

    @Test fun reclaimGridSendsNothingWhileDetached() = runTest {
        val bridge = attached()
        bridge.session.updateSize(120, 40, 10, 20)
        advanceTimeBy(200)
        receive(PtyFrame.Resized(100, 40))
        bridge.detach()
        repo.ptyResizes.clear()

        bridge.reclaimGrid()

        assertEquals(emptyList<Triple<String, Int, Int>>(), repo.ptyResizes)
    }

    @Test fun tooSmallRemoteSizeIsClamped() = runTest {
        val bridge = attached()
        receive(PtyFrame.Resized(1, 1))
        assertEquals(2 to 2, bridge.grid)
    }

    @Test fun reconnectResubscribes() = runTest {
        val bridge = attached()
        repo.connection.value = ConnectionState.Connecting(attempt = 1)
        runCurrent()
        repo.connection.value = ConnectionState.Connected(HELLO)
        runCurrent()

        assertEquals(2, repo.ptySubscriptions.size)
        receive(PtyFrame.Snapshot(80, 24, "after reconnect".toByteArray()))
        assertTrue(bridge.text.contains("after reconnect"))
    }

    @Test fun attachReplacesTheCollectionAndDetachEndsIt() = runTest {
        val bridge = attached()
        bridge.attach(80, 24)
        runCurrent()
        assertEquals(1, frames.subscriptionCount.value)

        bridge.detach()
        runCurrent()

        assertEquals(0, frames.subscriptionCount.value)
    }

    @Test fun refusedSubscriptionIsReported() = runTest {
        repo.ptyFailure = AfkError("not_found", "no session s_1")
        val bridge = attached()
        assertEquals("not_found", bridge.failure.value?.code)
    }

    @Test fun callsOffTheMainThreadFail() = runTest {
        val bridge = TerminalBridge(repo, "s_1", backgroundScope)
        val errors = withContext(Dispatchers.Default) {
            listOf(
                runCatching { bridge.attach(80, 24) },
                runCatching { bridge.onSizeChanged(80, 24) }
            ).map { it.exceptionOrNull() }
        }
        assertTrue(errors.all { it is IllegalStateException })
    }

    @Test fun userCopyGoesToTheClipboard() = runTest {
        val bridge = attached()
        val copied = mutableListOf<String>()
        bridge.session.onCopyText = { copied += it }

        // What TerminalView's selection menu calls on Copy.
        bridge.session.onCopyTextToClipboard("selected text")

        assertEquals(listOf("selected text"), copied)
    }

    @Test fun programCopyRequestIsIgnored() = runTest {
        val bridge = attached()
        val copied = mutableListOf<String>()
        bridge.session.onCopyText = { copied += it }

        // OSC 52: a program asks to set the clipboard to "secret".
        receive(PtyFrame.Data("\u001b]52;c;c2VjcmV0\u0007".toByteArray()))

        assertEquals(emptyList<String>(), copied)
    }

    @Test fun pasteTypesTheClipboardBracketedWhenAsked() = runTest {
        val bridge = attached()
        // The program turns bracketed paste on.
        receive(PtyFrame.Data("\u001b[?2004h".toByteArray()))
        bridge.session.onPasteRequest = { "ls\nexit" }

        // What TerminalView's selection menu calls on Paste.
        bridge.session.onPasteTextFromClipboard()

        val typed = repo.ptyInputs.joinToString("") { String(it.second) }
        assertEquals("\u001b[200~ls\rexit\u001b[201~", typed)
    }

    @Test fun secondaryDeviceAttributesReplyIsNotAnsweredAgain() = runTest {
        attached()
        receive(PtyFrame.Data("\u001b[>c".toByteArray()))
        // A program that echoes its input sends the reply back as output.
        receive(PtyFrame.Data("\u001b[>41;320;0c".toByteArray()))

        val typed = repo.ptyInputs.map { String(it.second) }
        assertEquals(listOf("\u001b[>41;320;0c"), typed)
    }
}
