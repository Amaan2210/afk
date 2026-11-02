package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ModelInfo
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.Strip
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.session
import io.github.amaankhan63.afk.service.ForegroundTracker
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
import org.junit.Assert.assertNull
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
        ForegroundTracker.set(null)
        Dispatchers.resetMain()
    }

    /** Collects [flow] into [into] until the test ends, as a screen does. */
    private fun <T> TestScope.collecting(flow: Flow<T>, into: MutableList<T> = mutableListOf()) {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { flow.toList(into) }
    }

    @Test fun sendLineAppendsCarriageReturnAndClears() = runTest {
        collecting(vm.ui)
        vm.onComposer("hello")
        assertEquals("hello", vm.ui.value.composer)

        vm.sendLine()

        assertArrayEquals("hello\r".toByteArray(), repo.lastInput)
        assertEquals("", vm.ui.value.composer)
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

    @Test fun pausingLeavesAnotherSessionInFront() {
        vm.onResumed()
        // The session a resume opened came to the front before this screen paused.
        ForegroundTracker.set("s_2")

        vm.onPaused()

        assertEquals("s_2", ForegroundTracker.foregroundSessionId.value)
    }

    @Test fun selectedTabIsShown() = runTest {
        collecting(vm.ui)
        vm.selectTab(SessionTab.Chat)
        assertEquals(SessionTab.Chat, vm.ui.value.tab)
    }

    @Test fun answerGoesToTheRepository() = runTest {
        vm.answer("q_1", listOf(1), null, null)
        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "q_1", listOf(1), null, null)),
            repo.answers
        )
    }

    @Test fun changedPromptIsReportedNotRetried() = runTest {
        val errors = mutableListOf<AfkError>()
        collecting(vm.errors, errors)
        repo.answerResult = Result.failure(AfkError("pending_changed", "q_1 changed"))

        vm.answer("q_1", null, null, "allow")

        assertEquals(1, repo.answers.size)
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
