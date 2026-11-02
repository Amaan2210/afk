package io.github.amaankhan63.afk.service

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.PendingIntentCompat
import androidx.core.app.RemoteInput
import io.github.amaankhan63.afk.MainActivity
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.settings.NotificationPrefs

/**
 * Turns the daemon's `notify` messages into notifications, one per session (see
 * [NotificationActions.notificationId]), with the actions the event allows.
 */
class SessionNotifier(
    private val context: Context,
    private val prefsProvider: () -> NotificationPrefs
) {
    /**
     * The notification for [n]; null when the user turned its channel off, its session is on
     * screen ([ForegroundTracker]), or its event is one this app does not know.
     */
    fun build(n: ServerMessage.Notify): Notification? {
        val prefs = prefsProvider()
        val (channel, enabled) = when (n.event) {
            EVENT_NEEDS_INPUT -> NotificationChannels.NEEDS_INPUT to prefs.needsInput
            EVENT_FINISHED -> NotificationChannels.FINISHED to prefs.finished
            EVENT_SUBAGENT_FINISHED -> NotificationChannels.SUBAGENTS to prefs.subagents
            else -> return null
        }
        if (!enabled || ForegroundTracker.foregroundSessionId.value == n.sessionId) return null

        val open = openSession(n.sessionId)
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(SMALL_ICON)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setGroup(n.sessionId)
        answerActions(n).forEach(builder::addAction)
        builder.addAction(NotificationCompat.Action.Builder(0, "Open", open).build())
        return builder.build()
    }

    /** The actions before Open: a question's first choices and Reply, Allow and Deny, or Reply. */
    private fun answerActions(n: ServerMessage.Notify): List<NotificationCompat.Action> =
        when (n.event) {
            EVENT_FINISHED -> listOf(reply(n.sessionId))

            EVENT_NEEDS_INPUT -> when (val pending = n.pending) {
                is Pending.Question ->
                    pending.options.take(MAX_CHOICES).mapIndexed { index, option ->
                        choice(n.sessionId, pending.id, index, option.label)
                    } + reply(n.sessionId)

                is Pending.Permission -> listOf(
                    decision(n.sessionId, pending.id, "allow", "Allow"),
                    decision(n.sessionId, pending.id, "deny", "Deny")
                )

                // A prompt the daemon sent no details of: only the session can answer it safely.
                null -> emptyList()
            }

            else -> emptyList()
        }

    private fun choice(sessionId: String, pendingId: String, index: Int, label: String) =
        NotificationCompat.Action.Builder(
            0,
            label,
            broadcast(
                sessionId,
                "choice$index",
                actionIntent(NotificationActions.ACTION_CHOICE, sessionId)
                    .putExtra(NotificationActions.EXTRA_PENDING, pendingId)
                    .putExtra(NotificationActions.EXTRA_INDEX, index)
            )
        ).build()

    private fun decision(sessionId: String, pendingId: String, decision: String, title: String) =
        NotificationCompat.Action.Builder(
            0,
            title,
            broadcast(
                sessionId,
                decision,
                actionIntent(NotificationActions.ACTION_DECISION, sessionId)
                    .putExtra(NotificationActions.EXTRA_PENDING, pendingId)
                    .putExtra(NotificationActions.EXTRA_DECISION, decision)
            )
        ).build()

    private fun reply(sessionId: String): NotificationCompat.Action {
        val input = RemoteInput.Builder(NotificationActions.REMOTE_INPUT_KEY)
            .setLabel("Reply")
            .build()
        // Mutable: Android writes the typed text into the intent.
        val intent = broadcast(
            sessionId,
            "reply",
            actionIntent(NotificationActions.ACTION_REPLY, sessionId),
            mutable = true
        )
        return NotificationCompat.Action.Builder(0, "Reply", intent).addRemoteInput(input).build()
    }

    private fun actionIntent(action: String, sessionId: String): Intent =
        Intent(context, NotificationActionReceiver::class.java)
            .setAction(action)
            .putExtra(NotificationActions.EXTRA_SESSION, sessionId)

    /**
     * Each action of each session gets its own request code: Android tells PendingIntents apart by
     * it, not by their extras, and [PendingIntent.FLAG_UPDATE_CURRENT] puts the latest prompt's
     * extras into one a previous notification made.
     */
    private fun broadcast(
        sessionId: String,
        slot: String,
        intent: Intent,
        mutable: Boolean = false
    ): PendingIntent? = PendingIntentCompat.getBroadcast(
        context,
        requestCode(sessionId, slot),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT,
        mutable
    )

    /** Opens `afk://session/<id>` in a fresh task, whose activity reads the link at creation. */
    private fun openSession(sessionId: String): PendingIntent? {
        val link = Uri.Builder().scheme("afk").authority("session").appendPath(sessionId).build()
        val intent = Intent(Intent.ACTION_VIEW, link, context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        return PendingIntentCompat.getActivity(
            context,
            requestCode(sessionId, "open"),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT,
            false
        )
    }

    private fun requestCode(sessionId: String, slot: String): Int = "$sessionId:$slot".hashCode()

    companion object {
        /** A platform glyph until the app has its own monochrome icon. */
        const val SMALL_ICON = android.R.drawable.stat_notify_chat

        private const val EVENT_NEEDS_INPUT = "needs_input"
        private const val EVENT_FINISHED = "finished"
        private const val EVENT_SUBAGENT_FINISHED = "subagent_finished"

        /** A question offers its first three options as buttons; the others are picked in the app. */
        private const val MAX_CHOICES = 3
    }
}
