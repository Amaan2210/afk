package io.github.amaankhan63.afk.service

import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * What a session notification's action does (see [NotificationActions]): answers the pending
 * prompt or types the reply, then removes the notification. [NotificationActionReceiver] hands
 * every intent here.
 */
class NotificationActionHandler(
    private val repo: SessionsRepository,
    private val scope: CoroutineScope
) {
    /** Runs [handle] in the background and then calls [onDone], whatever the outcome. */
    fun dispatch(context: Context, intent: Intent, onDone: () -> Unit) {
        scope.launch {
            try {
                handle(context, intent)
            } finally {
                onDone()
            }
        }
    }

    /**
     * Sends what [intent] asks for. An answer to a prompt that no longer exists shows
     * "Already answered"; other failures, `pending_changed` included, are not retried. The
     * session's notification is removed in every case.
     */
    suspend fun handle(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra(NotificationActions.EXTRA_SESSION) ?: return
        try {
            val failure = send(sessionId, intent)?.exceptionOrNull()
            if ((failure as? AfkError)?.code == ERROR_NOT_FOUND) {
                withContext(Dispatchers.Main.immediate) {
                    Toast.makeText(context, "Already answered", Toast.LENGTH_SHORT).show()
                }
            }
        } finally {
            NotificationManagerCompat.from(context)
                .cancel(NotificationActions.notificationId(sessionId))
        }
    }

    /** The outcome of what [intent] asks for; null when it carries nothing to send. */
    private suspend fun send(sessionId: String, intent: Intent): Result<Unit>? {
        val pendingId = intent.getStringExtra(NotificationActions.EXTRA_PENDING)
        return when (intent.action) {
            NotificationActions.ACTION_CHOICE -> {
                val index = intent.getIntExtra(NotificationActions.EXTRA_INDEX, -1)
                if (pendingId == null || index < 0) return null
                repo.answerPending(sessionId, pendingId, choices = listOf(index))
            }

            NotificationActions.ACTION_DECISION -> {
                val decision = intent.getStringExtra(NotificationActions.EXTRA_DECISION)
                if (pendingId == null || decision == null) return null
                repo.answerPending(sessionId, pendingId, decision = decision)
            }

            NotificationActions.ACTION_REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(NotificationActions.REMOTE_INPUT_KEY)
                if (text.isNullOrEmpty()) return null
                repo.ptyInput(sessionId, "$text\r".toByteArray(Charsets.UTF_8))
                Result.success(Unit)
            }

            else -> null
        }
    }

    private companion object {
        const val ERROR_NOT_FOUND = "not_found"
    }
}
