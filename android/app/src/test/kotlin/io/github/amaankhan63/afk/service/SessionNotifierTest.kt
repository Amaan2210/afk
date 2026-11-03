package io.github.amaankhan63.afk.service

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.settings.NotificationPrefs
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class SessionNotifierTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    @After fun tearDown() = ForegroundTracker.set(null)

    private fun notifier(prefs: NotificationPrefs = NotificationPrefs()) =
        SessionNotifier(context) { prefs }

    private fun notify(
        event: String = "needs_input",
        sessionId: String = "s_1",
        pending: Pending? = null
    ) = ServerMessage.Notify(
        event = event,
        sessionId = sessionId,
        sessionName = "app",
        title = "app needs your input",
        body = "Which file?",
        pending = pending
    )

    private fun question(options: Int, allowsText: Boolean = true, multiSelect: Boolean = false) =
        Pending.Question(
            id = "q1",
            text = "Which file?",
            multiSelect = multiSelect,
            allowsText = allowsText,
            options = List(options) { Pending.Option("Option ${it + 1}") }
        )

    private fun permission() = Pending.Permission(id = "p1", tool = "Bash", summary = "npm test")

    private fun Notification.titles() = actions.map { it.title.toString() }

    private fun Notification.Action.savedIntent() = shadowOf(actionIntent).savedIntent

    @Test fun textQuestionHasTwoChoicesAndReply() {
        val n = notifier().build(notify(pending = question(options = 4)))!!
        assertEquals(listOf("Option 1", "Option 2", "Reply"), n.titles())
        assertEquals(NotificationChannels.NEEDS_INPUT, n.channelId)
    }

    @Test fun questionWithoutTextReplyHasThreeChoices() {
        val n = notifier().build(notify(pending = question(options = 4, allowsText = false)))!!
        assertEquals(listOf("Option 1", "Option 2", "Option 3"), n.titles())
    }

    @Test fun multiSelectQuestionHasOnlyOpen() {
        val n = notifier().build(notify(pending = question(options = 4, multiSelect = true)))!!
        assertEquals(listOf("Open"), n.titles())
    }

    @Test fun shortQuestionKeepsOpenInTheFreeSlot() {
        val n = notifier().build(notify(pending = question(options = 1)))!!
        assertEquals(listOf("Option 1", "Reply", "Open"), n.titles())
    }

    @Test fun permissionHasAllowDenyOpen() {
        assertEquals(
            listOf("Allow", "Deny", "Open"),
            notifier().build(notify(pending = permission()))!!.actions.map { it.title.toString() }
        )
    }

    @Test fun needsInputWithoutPendingHasOnlyOpen() {
        assertEquals(listOf("Open"), notifier().build(notify())!!.titles())
    }

    @Test fun finishedUsesDefaultChannelAndReply() {
        val n = notifier().build(notify(event = "finished"))!!
        assertEquals(NotificationChannels.FINISHED, n.channelId)
        assertNotNull(n.actions.first { it.title == "Reply" }.remoteInputs)
    }

    @Test fun subagentSuppressedByDefault() =
        assertNull(notifier().build(notify(event = "subagent_finished")))

    @Test fun suppressedWhenSessionInForeground() {
        ForegroundTracker.set("s_1")
        assertNull(notifier().build(notify(sessionId = "s_1")))
        ForegroundTracker.set(null)
    }

    @Test fun idIsStablePerSession() = assertEquals(
        NotificationActions.notificationId("s_1"),
        NotificationActions.notificationId("s_1")
    )

    @Test fun choiceActionsCarryTheirOptionIndexAndPendingId() {
        val n = notifier().build(notify(pending = question(options = 4, allowsText = false)))!!
        val choices = n.actions.map { it.savedIntent() }
        assertEquals(List(3) { NotificationActions.ACTION_CHOICE }, choices.map { it.action })
        assertEquals(
            listOf(0, 1, 2),
            choices.map { it.getIntExtra(NotificationActions.EXTRA_INDEX, -1) }
        )
        assertEquals(
            List(3) { "q1" },
            choices.map { it.getStringExtra(NotificationActions.EXTRA_PENDING) }
        )
        assertEquals(
            List(3) { "s_1" },
            choices.map { it.getStringExtra(NotificationActions.EXTRA_SESSION) }
        )
        // Distinct request codes, or the three choices would share one PendingIntent.
        val codes = n.actions.map { shadowOf(it.actionIntent).requestCode }
        assertEquals(3, codes.toSet().size)
    }

    @Test fun questionReplyCarriesThePendingIdAndFinishedReplyDoesNot() {
        val question = notifier().build(notify(pending = question(options = 2)))!!
        val questionReply = question.actions.first { it.title == "Reply" }.savedIntent()
        assertEquals("q1", questionReply.getStringExtra(NotificationActions.EXTRA_PENDING))

        val finished = notifier().build(notify(event = "finished", sessionId = "s_2"))!!
        val finishedReply = finished.actions.first { it.title == "Reply" }.savedIntent()
        assertFalse(finishedReply.hasExtra(NotificationActions.EXTRA_PENDING))
    }

    @Test fun replyIsMutableAndTheOtherActionsImmutable() {
        val n = notifier().build(notify(event = "finished"))!!
        val reply = n.actions.first { it.title == "Reply" }
        assertEquals(NotificationActions.REMOTE_INPUT_KEY, reply.remoteInputs.single().resultKey)
        val replyFlags = shadowOf(reply.actionIntent).flags
        assertEquals(PendingIntent.FLAG_MUTABLE, replyFlags and PendingIntent.FLAG_MUTABLE)
        val openFlags = shadowOf(n.actions.first { it.title == "Open" }.actionIntent).flags
        assertEquals(PendingIntent.FLAG_IMMUTABLE, openFlags and PendingIntent.FLAG_IMMUTABLE)
    }

    /** A running app keeps its task and gets the link through onNewIntent. */
    @Test fun contentIntentOpensTheSessionDeepLink() {
        val n = notifier().build(notify(event = "finished", sessionId = "s_7"))!!
        val intent = shadowOf(n.contentIntent).savedIntent
        assertEquals("afk://session/s_7", intent.dataString)
        val reuse = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        assertEquals(reuse, intent.flags and reuse)
        assertEquals(0, intent.flags and Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }

    @Test fun subagentShowsOnlyOpenWhenEnabled() {
        val n = notifier(NotificationPrefs(subagents = true))
            .build(notify(event = "subagent_finished"))!!
        assertEquals(NotificationChannels.SUBAGENTS, n.channelId)
        assertEquals(listOf("Open"), n.titles())
    }

    @Test fun disabledChannelIsSuppressed() =
        assertNull(notifier(NotificationPrefs(finished = false)).build(notify(event = "finished")))
}
