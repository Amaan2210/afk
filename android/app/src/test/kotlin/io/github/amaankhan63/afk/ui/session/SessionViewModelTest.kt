package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ModelInfo
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.Strip
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.sessions.session
import io.github.amaankhan63.afk.service.ForegroundTracker
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric: the terminal bridge the view model owns makes a main-thread Handler. */
@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
@RunWith(RobolectricTestRunner::class)
class SessionViewModelTest {
    private val repo = FakeSessionsRepository()
    private lateinit var vm: SessionViewModel

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vm = SessionViewModel(repo, "s_1")
    }

    @After fun tearDown() {
        vm.onPaused()
        Dispatchers.resetMain()
    }

    private fun question(multiSelect: Boolean = false) = Pending.Question(
        id = "q_1",
        text = "Which pet?",
        multiSelect = multiSelect,
        allowsText = true,
        options = listOf(Pending.Option("Cats"), Pending.Option("Dogs"))
    )

    /** Session s_1 waiting on [pending]. */
    private fun waiting(pending: Pending) =
        session("s_1", state = SessionState.needs_input).copy(pending = pending)

    /** Collects [flow] into [into] until the test ends, as a screen does. */
    private fun <T> TestScope.collecting(flow: Flow<T>, into: MutableList<T> = mutableListOf()) {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { flow.toList(into) }
    }

    @Test fun sendLineAppendsCarriageReturnAndClears() = runTest {
        repo.connection.value = ConnectionState.Connected(HELLO)
        collecting(vm.ui)
        vm.onComposer("hello")
        assertEquals("hello", vm.ui.value.composer)

        assertTrue(vm.sendLine())

        assertArrayEquals("hello\r".toByteArray(), repo.lastInput)
        assertEquals("", vm.ui.value.composer)
    }

    /** Typed into the terminal, the text would be dropped and Enter would pick option 1. */
    @Test fun sendLineAnswersAQuestionThatTakesText() = runTest {
        repo.connection.value = ConnectionState.Connected(HELLO)
        repo.sessions.value = listOf(waiting(question()))
        collecting(vm.ui)
        assertEquals("Your answer…", vm.ui.value.composerPlaceholder)
        vm.onComposer("Use ferrets")

        assertTrue(vm.sendLine())

        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "q_1", null, "Use ferrets", null)),
            repo.answers
        )
        assertEquals(emptyList<Pair<String, ByteArray>>(), repo.ptyInputs)
        assertEquals("", vm.ui.value.composer)
    }

    @Test fun sendLineTypesWhenNothingIsPending() = runTest {
        repo.connection.value = ConnectionState.Connected(HELLO)
        repo.sessions.value = listOf(session("s_1", state = SessionState.working))
        collecting(vm.ui)
        vm.onComposer("ls")

        assertTrue(vm.sendLine())

        assertEquals(listOf("ls\r"), repo.ptyInputs.map { String(it.second) })
        assertEquals("Type, then send as a line…", vm.ui.value.composerPlaceholder)
    }

    /**
     * The daemon refuses free text on a multi-select question, and typed into the terminal the
     * text's Enter would confirm whatever the prompt highlights; so would a permission's.
     */
    @Test fun sendLineHoldsTheTextWhileAPromptTakesNoText() = runTest {
        repo.connection.value = ConnectionState.Connected(HELLO)
        repo.sessions.value = listOf(waiting(question(multiSelect = true)))
        val errors = mutableListOf<AfkError>()
        collecting(vm.ui)
        collecting(vm.errors, errors)
        assertEquals("Answer the prompt above", vm.ui.value.composerPlaceholder)
        vm.onComposer("x")

        assertFalse(vm.sendLine())
        vm.selectTab(SessionTab.Chat)
        repo.sessions.value = listOf(waiting(Pending.Permission("p_1", "Bash", "rm -rf build")))
        assertFalse(vm.sendLine())

        assertEquals(emptyList<Pair<String, ByteArray>>(), repo.ptyInputs)
        assertEquals(emptyList<FakeSessionsRepository.Answer>(), repo.answers)
        assertEquals("x", vm.ui.value.composer)
        assertEquals(
            listOf("Answer the prompt above", "Answer the card above"),
            errors.map { it.message }
        )
        assertEquals("Answer the card above", vm.ui.value.composerPlaceholder)
    }

    @Test fun sendLineWhileDisconnectedKeepsTheText() = runTest {
        repo.connection.value = ConnectionState.Connecting(attempt = 1)
        val errors = mutableListOf<AfkError>()
        collecting(vm.ui)
        collecting(vm.errors, errors)
        vm.onComposer("hello")

        assertFalse(vm.sendLine())

        assertEquals(emptyList<Pair<String, ByteArray>>(), repo.ptyInputs)
        assertEquals("hello", vm.ui.value.composer)
        assertEquals(ERROR_DISCONNECTED, errors.single().code)
    }

    @Test fun workingSessionKeepsTheTimeItWasFirstSeenWorking() = runTest {
        val start = Instant.parse("2026-11-02T10:00:00Z")
        var now = start
        val timed = SessionViewModel(repo, "s_1", clock = { now })
        collecting(timed.ui)

        repo.sessions.value = listOf(session(id = "s_1", state = SessionState.working))
        now = start.plusSeconds(60)
        repo.sessions.value =
            listOf(session(id = "s_1", state = SessionState.working, lastMessage = "still"))
        assertEquals(start, timed.ui.value.workingSince)

        repo.sessions.value = listOf(session(id = "s_1", state = SessionState.finished))
        assertNull(timed.ui.value.workingSince)
    }

    @Test fun sendKeysWritesBytesUnchanged() {
        vm.sendKeys(byteArrayOf(0x1b, 0x03))
        assertArrayEquals(byteArrayOf(0x1b, 0x03), repo.lastInput)
        assertEquals("s_1", repo.ptyInputs.single().first)
    }

    @Test fun stripHiddenForShellSession() = runTest {
        collecting(vm.ui)
        repo.sessions.value = listOf(session(id = "s_1", kind = SessionKind.shell))
        // Values the default chips would show, were the session not a shell.
        repo.strip("s_1").value =
            Strip(at = "t", model = ModelInfo("m", "Fable 5.1"), costUsd = 3.6)

        assertEquals(emptyList<String>(), vm.ui.value.shownChips)
    }

    @Test fun stripShowsTheChipsThatHaveValues() = runTest {
        collecting(vm.ui)
        repo.sessions.value = listOf(session(id = "s_1", kind = SessionKind.claude))
        repo.strip("s_1").value =
            Strip(at = "t", model = ModelInfo("m", "Fable 5.1"), costUsd = 3.6)

        assertEquals(listOf("✦ Fable 5.1", "$3.60"), vm.ui.value.shownChips)
    }

    @Test fun setsForegroundTrackerWhileActive() {
        vm.onResumed()
        assertEquals("s_1", ForegroundTracker.foregroundSessionId.value)

        vm.onPaused()
        assertNull(ForegroundTracker.foregroundSessionId.value)
    }

    @Test fun pausingLeavesAnotherScreenInFront() {
        val thread = Any()
        vm.onResumed()
        // A sub-agent's thread came to the front before this screen paused.
        ForegroundTracker.claim(thread, "s_1")

        vm.onPaused()

        assertEquals("s_1", ForegroundTracker.foregroundSessionId.value)
        ForegroundTracker.release(thread)
        assertNull(ForegroundTracker.foregroundSessionId.value)
    }

    @Test fun selectedTabIsShown() = runTest {
        collecting(vm.ui)
        vm.selectTab(SessionTab.Chat)
        assertEquals(SessionTab.Chat, vm.ui.value.tab)
    }

    @Test fun answerGoesToTheRepository() = runTest {
        repo.connection.value = ConnectionState.Connected(HELLO)
        assertTrue(vm.answer("q_1", listOf(1), null, null))
        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "q_1", listOf(1), null, null)),
            repo.answers
        )
    }

    /** The card stays answerable: nothing went out. */
    @Test fun answerWhileDisconnectedSendsNothing() = runTest {
        val errors = mutableListOf<AfkError>()
        collecting(vm.errors, errors)

        assertFalse(vm.answer("q_1", listOf(1), null, null))

        assertEquals(emptyList<FakeSessionsRepository.Answer>(), repo.answers)
        assertEquals(listOf(ERROR_DISCONNECTED), errors.map { it.code })
    }

    @Test fun changedPromptIsReportedNotRetried() = runTest {
        repo.connection.value = ConnectionState.Connected(HELLO)
        val errors = mutableListOf<AfkError>()
        collecting(vm.errors, errors)
        repo.answerResult = Result.failure(AfkError("pending_changed", "q_1 changed"))

        vm.answer("q_1", null, null, "allow")

        assertEquals(1, repo.answers.size)
        assertEquals("The prompt changed; check the terminal", errors.single().message)
    }

    /** A card tapped after its prompt went away: the daemon has no such pending any more. */
    @Test fun answerToAPromptThatIsGoneSaysItChanged() = runTest {
        repo.connection.value = ConnectionState.Connected(HELLO)
        val errors = mutableListOf<AfkError>()
        collecting(vm.errors, errors)
        repo.answerResult = Result.failure(AfkError("not_found", "no pending q_1 on s_1"))

        vm.answer("q_1", listOf(0), null, null)

        assertEquals("The prompt changed; check the terminal", errors.single().message)
    }

    @Test fun killRenameAndResumeTargetTheSession() = runTest {
        val opened = mutableListOf<String>()
        vm.kill()
        vm.rename("api")
        vm.resume { opened += it }

        assertEquals(listOf("s_1"), repo.killed)
        assertEquals(listOf("s_1" to "api"), repo.renamed)
        assertEquals(listOf("s_1"), repo.resumed)
        assertEquals(listOf("s_resumed"), opened)
    }

    @Test fun failedRequestIsReported() = runTest {
        val errors = mutableListOf<AfkError>()
        collecting(vm.errors, errors)
        repo.killResult = Result.failure(AfkError("not_found", "no session s_1"))

        vm.kill()

        assertEquals("not_found", errors.single().code)
    }
}
