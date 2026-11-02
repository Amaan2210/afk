package io.github.amaankhan63.afk.ui.session.terminal

import com.termux.terminal.TerminalEmulator
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.sessions.PtyFrame
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
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
        val bridge = TerminalBridge(repo, "s_1", backgroundScope)
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
}
