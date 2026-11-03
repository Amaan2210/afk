package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.sessions.ChatUpdate
import io.github.amaankhan63.afk.data.sessions.ERROR_TIMEOUT
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.sessions.chatEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // advanceTimeBy, runCurrent, UnconfinedTestDispatcher
class ChatEventsTest {
    private val repo = FakeSessionsRepository()

    /** Subscribes to [ChatEvents.events] as a screen does, until the returned job is cancelled. */
    private fun TestScope.showing(chat: ChatEvents): Job {
        val job = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            chat.events.collect {}
        }
        runCurrent()
        return job
    }

    private fun TestScope.receive(update: ChatUpdate, threadId: String = "main") {
        repo.chatUpdates("s_1", threadId).tryEmit(update)
        runCurrent()
    }

    @Test fun foldsTheSnapshotAndTheEventsAfterIt() = runTest {
        val chat = ChatEvents(repo, "s_1", scope = backgroundScope)
        showing(chat)

        receive(ChatUpdate.Snapshot(listOf(chatEvent("e1"), chatEvent("e2"))))
        receive(ChatUpdate.Event(chatEvent("e1", text = "edited")))
        receive(ChatUpdate.Event(chatEvent("e3")))

        assertEquals(
            listOf(chatEvent("e1", text = "edited"), chatEvent("e2"), chatEvent("e3")),
            chat.events.value
        )
        assertNull(chat.error.value)
    }

    /** Before the first snapshot the thread is unknown, not empty: the tab shows nothing yet. */
    @Test fun theEventsAreUnknownUntilTheFirstSnapshot() = runTest {
        val chat = ChatEvents(repo, "s_1", scope = backgroundScope)
        showing(chat)
        assertNull(chat.events.value)

        receive(ChatUpdate.Snapshot(emptyList()))

        assertEquals(emptyList<ChatEvent>(), chat.events.value)
    }

    /**
     * The Chat page stays composed, so no new collector comes after a timeout: the subscription is
     * made again once connected, and the error clears when the thread arrives.
     */
    @Test fun anUnansweredSubscriptionIsMadeAgainOnceConnected() = runTest {
        val timeout = AfkError(ERROR_TIMEOUT, "the daemon did not answer in time")
        repo.chatFailure = timeout
        val chat = ChatEvents(repo, "s_1", scope = backgroundScope)

        showing(chat)

        assertEquals(timeout, chat.error.value)
        assertEquals(1, repo.chatSubscriptions)

        repo.chatFailure = null
        repo.connection.value = ConnectionState.Connected(HELLO)
        runCurrent()
        assertEquals(2, repo.chatSubscriptions)
        assertEquals(timeout, chat.error.value)

        receive(ChatUpdate.Snapshot(listOf(chatEvent("e1"))))
        assertEquals(listOf(chatEvent("e1")), chat.events.value)
        assertNull(chat.error.value)
    }

    /** A refusal is the daemon's answer: it is not asked again when the connection comes back. */
    @Test fun aRefusalIsNotMadeAgainOnReconnect() = runTest {
        val refused = AfkError("not_found", "no session s_1")
        repo.chatFailure = refused
        val chat = ChatEvents(repo, "s_1", scope = backgroundScope)
        showing(chat)

        repo.connection.value = ConnectionState.Connected(HELLO)
        runCurrent()

        assertEquals(1, repo.chatSubscriptions)
        assertEquals(refused, chat.error.value)
    }

    @Test fun readsItsOwnThread() = runTest {
        val chat = ChatEvents(repo, "s_1", threadId = "t_2", scope = backgroundScope)
        showing(chat)

        receive(ChatUpdate.Snapshot(listOf(chatEvent("main"))))
        receive(ChatUpdate.Snapshot(listOf(chatEvent("sub", threadId = "t_2"))), threadId = "t_2")

        assertEquals(listOf(chatEvent("sub", threadId = "t_2")), chat.events.value)
    }

    @Test fun refusalBecomesTheErrorAndALaterSubscriberRetries() = runTest {
        val refused = AfkError("not_found", "no session s_1")
        repo.chatFailure = refused
        val chat = ChatEvents(repo, "s_1", scope = backgroundScope)

        val first = showing(chat)

        assertEquals(refused, chat.error.value)
        assertNull(chat.events.value)

        // The screen goes away for longer than the stop timeout, then comes back.
        first.cancel()
        advanceTimeBy(5_001)
        repo.chatFailure = null
        showing(chat)

        assertNull(chat.error.value)
        receive(ChatUpdate.Snapshot(listOf(chatEvent("e1"))))
        assertEquals(listOf(chatEvent("e1")), chat.events.value)
    }

    @Test fun aRestartKeepsTheListUntilTheSnapshot() = runTest {
        val chat = ChatEvents(repo, "s_1", scope = backgroundScope)
        val first = showing(chat)
        receive(ChatUpdate.Snapshot(listOf(chatEvent("e1"))))

        first.cancel()
        advanceTimeBy(5_001)
        val seen = mutableListOf<List<ChatEvent>?>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            chat.events.collect(seen::add)
        }
        runCurrent()
        receive(ChatUpdate.Snapshot(listOf(chatEvent("e1"), chatEvent("e2"))))

        assertEquals(
            listOf(listOf(chatEvent("e1")), listOf(chatEvent("e1"), chatEvent("e2"))),
            seen
        )
    }
}
