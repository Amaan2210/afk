package io.github.amaankhan63.afk.service

import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.sessions.ERROR_TIMEOUT
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

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
     * Sends what [intent] asks for, giving up after [BUDGET_MS] so the receiver finishes within
     * Android's limit. An answer to a prompt that no longer exists shows "Already answered"; any
     * other failure shows "Not sent: …" and is not retried (a `pending_changed` answer may be
     * partly typed). The session's notification is removed in every case.
     */
    suspend fun handle(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra(NotificationActions.EXTRA_SESSION) ?: return
        try {
            // Nothing to send counts as sent: there is nothing to report.
            val outcome = withTimeoutOrNull(BUDGET_MS) {
                send(sessionId, intent) ?: Result.success(Unit)
            }
            val failure = if (outcome == null) {
                AfkError(ERROR_TIMEOUT, "timeout")
            } else {
                outcome.exceptionOrNull()
            }
            if (failure != null) toast(context, messageFor(failure))
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
                    ?.toString()
                if (text.isNullOrEmpty()) return null
                if (pendingId != null) {
                    repo.answerPending(sessionId, pendingId, text = text)
                } else {
                    type(sessionId, text)
                }
            }

            else -> null
        }
    }

    /** Types [text] and Enter into the session; input sent while not connected would be lost. */
    private fun type(sessionId: String, text: String): Result<Unit> {
        if (repo.connection.value !is ConnectionState.Connected) {
            return Result.failure(AfkError(ERROR_DISCONNECTED, "not connected to the laptop"))
        }
        repo.typeLine(sessionId, text)
        return Result.success(Unit)
    }

    private fun messageFor(failure: Throwable): String =
        if ((failure as? AfkError)?.code == ERROR_NOT_FOUND) {
            "Already answered"
        } else {
            "Not sent: ${failure.message ?: "unknown error"}"
        }

    /** A Toast must be shown from the main thread; the handler runs in the background. */
    private suspend fun toast(context: Context, text: String) =
        withContext(Dispatchers.Main.immediate) {
            Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
        }

    private companion object {
        const val ERROR_NOT_FOUND = "not_found"

        /** Under the 10 s Android gives a receiver that called `goAsync`. */
        const val BUDGET_MS = 8_000L
    }
}
