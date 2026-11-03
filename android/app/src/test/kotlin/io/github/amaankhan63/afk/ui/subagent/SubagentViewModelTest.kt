package io.github.amaankhan63.afk.ui.subagent

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind
import io.github.amaankhan63.afk.data.protocol.SubagentInfo
import io.github.amaankhan63.afk.data.protocol.SubagentStatus
import io.github.amaankhan63.afk.data.sessions.ChatUpdate
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.chatEvent
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
class SubagentViewModelTest {
    private val repo = FakeSessionsRepository()
    private lateinit var vm: SubagentViewModel

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vm = SubagentViewModel(repo, "s_1", "agent-b")
    }

    @After fun tearDown() = Dispatchers.resetMain()

    /** The main thread's card for sub-agent [threadId]. */
    private fun card(
        threadId: String,
        task: String = "Find the flaky test",
        name: String = "general-purpose",
        status: SubagentStatus = SubagentStatus.running,
        toolUses: Int = 5
    ) = ChatEvent(
        id = "e_$threadId",
        threadId = "main",
        at = "2026-10-30T10:00:00.000Z",
        kind = ChatKind.subagent,
        subagent = SubagentInfo(threadId, name, task, status, toolUses)
    )

    /** Collects [flow] into [into] until the test ends, as a screen does. */
    private fun <T> TestScope.collecting(flow: Flow<T>, into: MutableList<T> = mutableListOf()) {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { flow.toList(into) }
    }

    private fun mainSnapshot(vararg events: ChatEvent) {
        repo.chatUpdates("s_1", "main").tryEmit(ChatUpdate.Snapshot(events.toList()))
    }

    @Test fun titleAndStatusComeFromTheParentCard() = runTest {
        collecting(vm.title)
        collecting(vm.status)

        mainSnapshot(chatEvent("e1"), card("agent-a", task = "Other work"), card("agent-b"))

        assertEquals("Find the flaky test", vm.title.value)
        assertEquals("running · 5 tool uses", vm.status.value)

        repo.chatUpdates("s_1", "main").tryEmit(
            ChatUpdate.Event(card("agent-b", status = SubagentStatus.done, toolUses = 1))
        )
        assertEquals("done · 1 tool use", vm.status.value)
    }

    @Test fun titleFallsBackToTheNameThenSubAgent() = runTest {
        collecting(vm.title)
        collecting(vm.status)
        assertEquals("Sub-agent", vm.title.value)

        mainSnapshot(chatEvent("e1"), card("agent-a"))
        assertEquals("Sub-agent", vm.title.value)
        assertNull(vm.status.value)

        mainSnapshot(card("agent-b", task = " ", name = "explorer"))
        assertEquals("explorer", vm.title.value)

        mainSnapshot(card("agent-b", task = "", name = ""))
        assertEquals("Sub-agent", vm.title.value)
    }

    @Test fun chatShowsTheSubAgentsOwnThread() = runTest {
        collecting(vm.chat.events)

        mainSnapshot(chatEvent("main-1"))
        repo.chatUpdates("s_1", "agent-b")
            .tryEmit(ChatUpdate.Snapshot(listOf(chatEvent("sub-1", threadId = "agent-b"))))

        assertEquals(listOf(chatEvent("sub-1", threadId = "agent-b")), vm.chat.events.value)
    }

    @Test fun answerGoesToTheSession() = runTest {
        vm.answer("q_1", listOf(1), null, null)

        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "q_1", listOf(1), null, null)),
            repo.answers
        )
    }

    @Test fun aStaleAnswerIsReportedInWords() = runTest {
        val errors = mutableListOf<AfkError>()
        collecting(vm.errors, errors)

        repo.answerResult = Result.failure(AfkError("pending_changed", "q_1 changed"))
        vm.answer("q_1", null, null, "allow")
        repo.answerResult = Result.failure(AfkError("not_found", "no pending q_1 on s_1"))
        vm.answer("q_1", listOf(0), null, null)
        repo.answerResult = Result.failure(AfkError("bad_request", "choices out of range"))
        vm.answer("q_1", listOf(9), null, null)

        assertEquals(
            listOf(
                "pending_changed" to "The prompt changed; check the terminal",
                "not_found" to "The prompt changed; check the terminal",
                "bad_request" to "choices out of range"
            ),
            errors.map { it.code to it.message }
        )
    }
}
