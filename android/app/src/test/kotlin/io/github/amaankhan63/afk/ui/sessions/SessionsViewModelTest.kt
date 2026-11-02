package io.github.amaankhan63.afk.ui.sessions

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.sessions.SessionFilter
import io.github.amaankhan63.afk.data.sessions.StateFilter
import io.github.amaankhan63.afk.data.sessions.session
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
class SessionsViewModelTest {
    private val repo = FakeSessionsRepository()
    private val start = Instant.parse("2026-10-30T10:00:00Z")
    private var now = start

    private val needsCodex =
        session(id = "s_codex", kind = SessionKind.codex, state = SessionState.needs_input)
    private val workingClaude =
        session(id = "s_work", kind = SessionKind.claude, state = SessionState.working)
    private val idleShell =
        session(
            id = "s_shell",
            name = "ToolKit",
            kind = SessionKind.shell,
            state = SessionState.idle
        )
    private val endedClaude =
        session(id = "s_ended", kind = SessionKind.claude, state = SessionState.ended)

    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    private fun viewModel() = SessionsViewModel(repo) { now }

    /** Collects [flow] into [into] until the test ends or the job is cancelled, as a screen does. */
    private fun <T> TestScope.collecting(
        flow: Flow<T>,
        into: MutableList<T> = mutableListOf()
    ): Job = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { flow.toList(into) }

    /** A view model whose [SessionsViewModel.ui] a screen is showing. */
    private fun TestScope.shownViewModel(): SessionsViewModel = viewModel().also {
        collecting(it.ui)
    }

    private fun SessionsViewModel.ids() = ui.value.sessions.map { it.id }

    @Test fun appliesSearchFilterAndOrder() = runTest {
        // Out of order on purpose: the view model sorts what the screen lists.
        repo.sessions.value = listOf(endedClaude, idleShell, workingClaude, needsCodex)
        val vm = shownViewModel()

        vm.onQuery("")
        vm.onFilter(SessionFilter(agents = setOf(SessionKind.claude)))
        assertEquals(listOf("s_work", "s_ended"), vm.ids())

        vm.onFilter(SessionFilter())
        vm.onQuery("toolkit")
        assertEquals(listOf("s_shell"), vm.ids())
        assertEquals("toolkit", vm.ui.value.query)
        assertEquals(SessionFilter(), vm.ui.value.filter)
    }

    @Test fun countsReflectUnfilteredSessions() = runTest {
        repo.sessions.value = listOf(needsCodex, workingClaude, idleShell, endedClaude)
        val vm = shownViewModel()
        val everything = mapOf(
            StateFilter.All to 4,
            StateFilter.NeedsYou to 1,
            StateFilter.Working to 1,
            StateFilter.Done to 1
        )

        vm.onFilter(SessionFilter(state = StateFilter.Working))
        assertEquals(listOf("s_work"), vm.ids())
        assertEquals(1, vm.ui.value.counts[StateFilter.NeedsYou])
        assertEquals(everything, vm.ui.value.counts)

        vm.onQuery("toolkit")
        assertEquals(emptyList<String>(), vm.ids())
        assertEquals(everything, vm.ui.value.counts)
        // Every session stays reachable for the long-press actions, whatever the list shows.
        val all = vm.ui.value.allSessions.map { it.id }
        assertEquals(listOf("s_codex", "s_work", "s_shell", "s_ended"), all)
    }

    @Test fun carriesStatsAndConnection() = runTest {
        val vm = shownViewModel()
        val stats = Stats("2026-10-30T10:00:00.000Z", 12, 16, 34.0, keepAwakeActive = true)

        repo.stats.value = stats
        repo.connection.value = ConnectionState.Connecting(2)

        assertEquals(stats, vm.ui.value.stats)
        assertEquals(ConnectionState.Connecting(2), vm.ui.value.connection)
    }

    @Test fun hostnameIsKeptWhileReconnecting() = runTest {
        val vm = viewModel()
        val screen = collecting(vm.ui)
        assertNull(vm.ui.value.hostname)

        repo.connection.value = ConnectionState.Connected(HELLO)
        assertEquals("MY-LAPTOP", vm.ui.value.hostname)

        repo.connection.value = ConnectionState.Connecting(1)
        assertEquals("MY-LAPTOP", vm.ui.value.hostname)

        // The screen goes away long enough for the ui pipeline to stop, then comes back.
        screen.cancel()
        advanceTimeBy(6_000)
        collecting(vm.ui)
        assertEquals("MY-LAPTOP", vm.ui.value.hostname)
    }

    @Test fun workingSinceCountsFromTheFirstWorkingObservation() = runTest {
        repo.sessions.value = listOf(workingClaude)
        val vm = shownViewModel()
        assertEquals(mapOf("s_work" to start), vm.ui.value.workingSince)

        // Output keeps arriving: the session has been working since it was first seen working.
        now = start.plusSeconds(60)
        val later = workingClaude.copy(lastActivityAt = "2026-10-30T10:01:00.000Z")
        repo.sessions.value = listOf(later, needsCodex)
        assertEquals(mapOf("s_work" to start), vm.ui.value.workingSince)

        repo.sessions.value = listOf(workingClaude.copy(state = SessionState.finished))
        assertEquals(emptyMap<String, Instant>(), vm.ui.value.workingSince)

        now = start.plusSeconds(120)
        repo.sessions.value = listOf(workingClaude)
        assertEquals(mapOf("s_work" to start.plusSeconds(120)), vm.ui.value.workingSince)

        repo.sessions.value = emptyList()
        assertEquals(emptyMap<String, Instant>(), vm.ui.value.workingSince)
    }

    @Test fun killAndRenameReachTheRepositoryAndFailuresSurface() = runTest {
        val vm = shownViewModel()
        val errors = mutableListOf<AfkError>()
        collecting(vm.errors, errors)
        repo.killResult = Result.failure(AfkError("not_found", "no session s_gone"))

        vm.kill("s_gone")
        vm.rename("s_1", "api")

        assertEquals(listOf("s_gone"), repo.killed)
        assertEquals(listOf("s_1" to "api"), repo.renamed)
        assertEquals(listOf("not_found"), errors.map { it.code })
    }

    @Test fun resumeOpensTheNewSession() = runTest {
        val vm = shownViewModel()
        val resumed = mutableListOf<String>()
        val errors = mutableListOf<AfkError>()
        collecting(vm.resumed, resumed)
        collecting(vm.errors, errors)
        repo.resumeResult = Result.success("s_new")

        vm.resume("s_ended")

        assertEquals(listOf("s_ended"), repo.resumed)
        assertEquals(listOf("s_new"), resumed)
        assertEquals(emptyList<AfkError>(), errors)
    }

    @Test fun failedResumeOpensNothing() = runTest {
        val vm = shownViewModel()
        val resumed = mutableListOf<String>()
        val errors = mutableListOf<AfkError>()
        collecting(vm.resumed, resumed)
        collecting(vm.errors, errors)
        repo.resumeResult = Result.failure(AfkError("timeout", "the daemon did not answer"))

        vm.resume("s_ended")

        assertEquals(emptyList<String>(), resumed)
        assertEquals(listOf("timeout"), errors.map { it.code })
    }
}
