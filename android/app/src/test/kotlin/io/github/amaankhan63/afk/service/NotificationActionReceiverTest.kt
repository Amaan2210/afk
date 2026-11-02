package io.github.amaankhan63.afk.service

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowToast

/** Drives [NotificationActionHandler], which holds all of the receiver's logic. */
@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
@RunWith(RobolectricTestRunner::class)
class NotificationActionReceiverTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val repo = FakeSessionsRepository()

    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    private fun choice(index: Int) = Intent(NotificationActions.ACTION_CHOICE)
        .putExtra(NotificationActions.EXTRA_SESSION, "s_1")
        .putExtra(NotificationActions.EXTRA_PENDING, "q1")
        .putExtra(NotificationActions.EXTRA_INDEX, index)

    @Test fun choiceSendsPendingAnswerWithIndex() = runTest {
        val manager = context.getSystemService(NotificationManager::class.java)
        val id = NotificationActions.notificationId("s_1")
        val shown = NotificationCompat.Builder(context, NotificationChannels.NEEDS_INPUT).build()
        manager.notify(id, shown)

        NotificationActionHandler(repo, backgroundScope).handle(context, choice(2))

        assertEquals(
            listOf(FakeSessionsRepository.Answer("s_1", "q1", listOf(2), null, null)),
            repo.answers
        )
        assertNull(shadowOf(manager).getNotification(id))
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
    }

    @Test fun replyWritesTextPlusCarriageReturn() = runTest {
        val intent = Intent(NotificationActions.ACTION_REPLY)
            .putExtra(NotificationActions.EXTRA_SESSION, "s_1")
        val typed = Bundle().apply { putCharSequence(NotificationActions.REMOTE_INPUT_KEY, "yes") }
        RemoteInput.addResultsToIntent(
            arrayOf(RemoteInput.Builder(NotificationActions.REMOTE_INPUT_KEY).build()),
            intent,
            typed
        )

        NotificationActionHandler(repo, backgroundScope).handle(context, intent)

        val (sessionId, bytes) = repo.ptyInputs.single()
        assertEquals("s_1", sessionId)
        assertArrayEquals("yes\r".toByteArray(Charsets.UTF_8), bytes)
    }
}
