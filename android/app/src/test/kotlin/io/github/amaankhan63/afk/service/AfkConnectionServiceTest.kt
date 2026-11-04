package io.github.amaankhan63.afk.service

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import io.github.amaankhan63.afk.MainActivity
import io.github.amaankhan63.afk.data.InMemoryDataStore
import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.connection.Endpoint
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.sessions.FakeConnectionManager
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.session
import io.github.amaankhan63.afk.data.settings.NotificationPrefs
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

@OptIn(ExperimentalCoroutinesApi::class) // UnconfinedTestDispatcher
@RunWith(RobolectricTestRunner::class)
class AfkConnectionServiceTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    /** Records what the service asks of the connection. */
    private class RecordingManager : ConnectionManager by FakeConnectionManager() {
        val calls = mutableListOf<String>()

        override fun start(endpoint: Endpoint, token: String) {
            calls += "start ${endpoint.host}"
        }

        override fun stop() {
            calls += "stop"
        }
    }

    /** A running app is brought forward as it is, not started again on top of itself. */
    @Test fun connectionNotificationReusesTheRunningActivity() {
        val intent = AfkConnectionService.openAppIntent(context)

        assertEquals(MainActivity::class.java.name, intent.component?.className)
        assertNull(intent.data)
        val flags = Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP
        assertEquals(flags, intent.flags and flags)
    }

    @Test fun aPairingConnectsAndClearingItStopsTheService() = runTest {
        val store = PairingStore(InMemoryDataStore())
        val manager = RecordingManager()
        var unpaired = 0
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            followPairing(store.pairingOrNone, manager) { unpaired++ }
        }

        store.save(PairingPayload("100.84.12.9", 2350, "tok_abc"))
        store.clear()

        assertEquals(listOf("stop", "stop", "start 100.84.12.9", "stop"), manager.calls)
        assertEquals(2, unpaired)
    }

    /** Preferences that cannot be read count as no pairing, rather than crashing the service. */
    @Test fun anUnreadablePairingStopsTheService() = runTest {
        val dataStore = InMemoryDataStore().apply { readFailures = 1 }
        val manager = RecordingManager()
        var unpaired = 0

        followPairing(PairingStore(dataStore).pairingOrNone, manager) { unpaired++ }

        assertEquals(listOf("stop"), manager.calls)
        assertEquals(1, unpaired)
    }

    /** Answered anywhere, a prompt's buttons would only say "Already answered". */
    @Test fun aPromptThatStopsWaitingTakesItsNotificationWithIt() = runTest {
        val repo = FakeSessionsRepository()
        val cancelled = mutableListOf<Int>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            cancelAnsweredPrompts(repo.sessions) { cancelled += it }
        }
        fun question(id: String) = Pending.Question(id, "Which?", false, true, emptyList())
        fun waiting(id: String, pending: Pending?) =
            session(id, state = SessionState.needs_input).copy(pending = pending)
        val working = session("s_4", state = SessionState.working)

        repo.sessions.value = listOf(
            waiting("s_1", question("q_1")),
            waiting("s_2", question("q_2")),
            waiting("s_3", null),
            working
        )
        assertEquals(emptyList<Int>(), cancelled)

        // Answered on the laptop; another question in its place; a prompt without details answered.
        repo.sessions.value = listOf(
            session("s_1", state = SessionState.working),
            waiting("s_2", question("q_3")),
            session("s_3", state = SessionState.working),
            working
        )
        val ids = listOf("s_1", "s_2", "s_3").map(NotificationActions::notificationId)
        assertEquals(ids, cancelled)

        // Gone with its session.
        cancelled.clear()
        repo.sessions.value = listOf(working)
        assertEquals(listOf(NotificationActions.notificationId("s_2")), cancelled)
    }

    /** Opening a session's screen takes its notifications with it: the user is looking at it. */
    @Test fun aSessionComingToTheFrontTakesItsNotificationsWithIt() = runTest {
        val foreground = MutableStateFlow<String?>(null)
        val cancelled = mutableListOf<Pair<String?, Int>>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            cancelOnScreen(foreground) { tag, id -> cancelled += tag to id }
        }
        assertEquals(emptyList<Pair<String?, Int>>(), cancelled)

        foreground.value = "s_1"

        val id = NotificationActions.notificationId("s_1")
        val both = listOf(null to id, NotificationActions.SUBAGENT_TAG to id)
        assertEquals(both, cancelled)

        // Leaving cancels nothing; coming back cancels what arrived meanwhile.
        cancelled.clear()
        foreground.value = null
        assertEquals(emptyList<Pair<String?, Int>>(), cancelled)
        foreground.value = "s_1"
        assertEquals(both, cancelled)
    }

    /**
     * With Sub-agents on, a sub-agent's end shows beside the session's question, not over it. The
     * notifications are built as the service builds them, so the tag comes from the notifier.
     */
    @Test fun aSubAgentsEndKeepsTheQuestionsNotification() {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        NotificationChannels.ensure(context)
        val posted = ConnectionNotification(context)
        val notifier = SessionNotifier(context) { NotificationPrefs(subagents = true) }
        fun post(event: String) {
            val n = ServerMessage.Notify(event, "s_1", "app", "app: $event", "body")
            val notification = checkNotNull(notifier.build(n)) { "no notification for $event" }
            val id = NotificationActions.notificationId(n.sessionId)
            posted.post(id, notification, NotificationActions.notificationTag(n))
        }

        post("needs_input")
        post("subagent_finished")

        val shown = shadowOf(context.getSystemService(NotificationManager::class.java))
        val id = NotificationActions.notificationId("s_1")
        assertNotNull(shown.getNotification(null, id))
        assertNotNull(shown.getNotification(NotificationActions.SUBAGENT_TAG, id))

        // The session's own events still replace each other.
        post("finished")
        assertEquals(2, shown.allNotifications.size)
        val titles = shown.allNotifications.map {
            it.extras.getCharSequence(NotificationCompat.EXTRA_TITLE).toString()
        }
        assertEquals(setOf("app: finished", "app: subagent_finished"), titles.toSet())
    }
}
