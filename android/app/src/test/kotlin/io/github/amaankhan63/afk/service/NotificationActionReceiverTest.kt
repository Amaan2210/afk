package io.github.amaankhan63.afk.service

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowBroadcastPendingResult
import org.robolectric.shadows.ShadowToast

/**
 * Drives [NotificationActionHandler], which holds the receiver's logic, and the receiver itself
 * once, as Android delivers an action.
 */
@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
@RunWith(RobolectricTestRunner::class)
class NotificationActionReceiverTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val repo = FakeSessionsRepository()
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val shownId = NotificationActions.notificationId("s_1")

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        repo.connection.value = ConnectionState.Connected(HELLO)
        val shown = NotificationCompat.Builder(context, NotificationChannels.NEEDS_INPUT).build()
        manager.notify(shownId, shown)
    }

    @After fun tearDown() = Dispatchers.resetMain()

    private fun choice(index: Int) = Intent(NotificationActions.ACTION_CHOICE)
        .putExtra(NotificationActions.EXTRA_SESSION, "s_1")
        .putExtra(NotificationActions.EXTRA_PENDING, "q1")
        .putExtra(NotificationActions.EXTRA_INDEX, index)

    /** What the Reply action sends after the user typed [text]. */
    private fun reply(text: String, pendingId: String? = null): Intent {
        val intent = Intent(NotificationActions.ACTION_REPLY)
            .putExtra(NotificationActions.EXTRA_SESSION, "s_1")
        if (pendingId != null) intent.putExtra(NotificationActions.EXTRA_PENDING, pendingId)
        val typed = Bundle().apply { putCharSequence(NotificationActions.REMOTE_INPUT_KEY, text) }
        RemoteInput.addResultsToIntent(
            arrayOf(RemoteInput.Builder(NotificationActions.REMOTE_INPUT_KEY).build()),
            intent,
            typed
        )
        return intent
    }

    private fun assertNotificationCancelled() {
        assertNull(shadowOf(manager).getNotification(shownId))
    }

    /**
     * Android's delivery: the receiver hands the intent to the handler in the background and
     * finishes the broadcast when it is done. A reply with nothing typed has nothing to send, so
     * the app's own graph serves, connected or not.
     */
    @Test fun theReceiverHandlesTheActionAndFinishes() {
        val intent = Intent(context, NotificationActionReceiver::class.java)
            .setAction(NotificationActions.ACTION_REPLY)
            .putExtra(NotificationActions.EXTRA_SESSION, "s_1")

        context.sendBroadcast(intent)
        shadowOf(Looper.getMainLooper()).idle()

        val receiver = shadowOf(context as Application).registeredReceivers
            .map { it.broadcastReceiver }
            .filterIsInstance<NotificationActionReceiver>()
            .single()
        assertTrue(shadowOf(receiver).wentAsync())
        val result = shadowOf(receiver).originalPendingResult
        Shadow.extract<ShadowBroadcastPendingResult>(result).future.get(5, TimeUnit.SECONDS)
        assertNotificationCancelled()
        assertNull(ShadowToast.getTextOfLatestToast())
    }

    @Test fun choiceSendsPendingAnswerWithIndex() = runTest {
        assertNotNull(shadowOf(manager).getNotification(shownId))

        NotificationActionHandler(repo, backgroundScope).handle(context, choice(2))

        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "q1", listOf(2), null, null)),
            repo.answers
        )
        assertNull(ShadowToast.getTextOfLatestToast())
        assertNotificationCancelled()
    }

    @Test fun decisionSendsTheDecision() = runTest {
        val intent = Intent(NotificationActions.ACTION_DECISION)
            .putExtra(NotificationActions.EXTRA_SESSION, "s_1")
            .putExtra(NotificationActions.EXTRA_PENDING, "p1")
            .putExtra(NotificationActions.EXTRA_DECISION, "deny")

        NotificationActionHandler(repo, backgroundScope).handle(context, intent)

        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "p1", null, null, "deny")),
            repo.answers
        )
    }

    @Test fun notFoundShowsAlreadyAnsweredToast() = runTest {
        repo.answerResult = Result.failure(AfkError("not_found", "no such pending prompt"))

        NotificationActionHandler(repo, backgroundScope).handle(context, choice(0))

        assertEquals("Already answered", ShadowToast.getTextOfLatestToast())
        assertNotificationCancelled()
    }

    @Test fun otherFailureShowsNotSentAndStillCancels() = runTest {
        repo.answerResult = Result.failure(AfkError("pending_changed", "the prompt changed"))

        NotificationActionHandler(repo, backgroundScope).handle(context, choice(0))

        assertEquals("Not sent: the prompt changed", ShadowToast.getTextOfLatestToast())
        assertNotificationCancelled()
    }

    @Test fun replyWritesTextPlusCarriageReturn() = runTest {
        NotificationActionHandler(repo, backgroundScope).handle(context, reply("yes"))

        val (sessionId, bytes) = repo.ptyInputs.single()
        assertEquals("s_1", sessionId)
        assertArrayEquals("yes\r".toByteArray(Charsets.UTF_8), bytes)
        assertNotificationCancelled()
    }

    @Test fun replyToAQuestionAnswersItWithText() = runTest {
        NotificationActionHandler(repo, backgroundScope).handle(context, reply("main.kt", "q1"))

        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "q1", null, "main.kt", null)),
            repo.answers
        )
        assertTrue(repo.ptyInputs.isEmpty())
    }

    @Test fun replyWhileDisconnectedShowsNotSentAndTypesNothing() = runTest {
        repo.connection.value = ConnectionState.Connecting(attempt = 1)

        NotificationActionHandler(repo, backgroundScope).handle(context, reply("yes"))

        assertTrue(repo.ptyInputs.isEmpty())
        assertEquals("Not sent: not connected to the laptop", ShadowToast.getTextOfLatestToast())
        assertNotificationCancelled()
    }
}
