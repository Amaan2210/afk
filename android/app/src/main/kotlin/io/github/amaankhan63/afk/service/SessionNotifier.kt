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
import io.github.amaankhan63.afk.R
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.settings.NotificationPrefs

/**
 * Turns the daemon's `notify` messages into notifications, one per session and one more for its
 * sub-agents (see [NotificationActions.notificationId]), with the actions the event allows.
 */
class SessionNotifier(
    private val context: Context,
    private val mutedProvider: () -> Set<String> = { emptySet() },
    private val prefsProvider: () -> NotificationPrefs
) {
    /**
     * The notification for [n]; null when the user turned its channel off or muted its session,
     * its session is on screen ([ForegroundTracker]), or its event is one this app does not know.
     */
    fun build(n: ServerMessage.Notify): Notification? {
        val prefs = prefsProvider()
        val (channel, enabled) = when (n.event) {
            EVENT_NEEDS_INPUT -> NotificationChannels.NEEDS_INPUT to prefs.needsInput
            EVENT_FINISHED -> NotificationChannels.FINISHED to prefs.finished
            EVENT_SUBAGENT_FINISHED -> NotificationChannels.SUBAGENTS to prefs.subagents
            else -> return null
        }
        if (!enabled || n.sessionId in mutedProvider()) return null
        if (ForegroundTracker.foregroundSessionId.value == n.sessionId) return null

        val open = openSession(n.sessionId)
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(SMALL_ICON)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setGroup(n.sessionId)
        val actions = answerActions(n)
        actions.forEach(builder::addAction)
        // Tapping the notification opens the session too, so Open only takes a slot left free.
        if (actions.size < MAX_ACTIONS) {
            builder.addAction(NotificationCompat.Action.Builder(0, "Open", open).build())
        }
        return builder.build()
    }

    /** The actions that answer [n], at most [MAX_ACTIONS] of them. */
    private fun answerActions(n: ServerMessage.Notify): List<NotificationCompat.Action> =
        when (n.event) {
            EVENT_FINISHED -> listOf(reply(n.sessionId))

            EVENT_NEEDS_INPUT -> when (val pending = n.pending) {
                is Pending.Question -> questionActions(n.sessionId, pending)

                is Pending.Permission -> listOf(
                    decision(n.sessionId, pending.id, "allow", "Allow"),
                    decision(n.sessionId, pending.id, "deny", "Deny")
                )

                // A prompt the daemon sent no details of: only the session can answer it safely.
                null -> emptyList()
            }

            else -> emptyList()
        }

    /**
     * The first options as buttons, plus Reply when the question takes a typed answer. A
     * multi-select question gets none: one tap cannot pick several options.
     */
    private fun questionActions(sessionId: String, q: Pending.Question) = when {
        q.multiSelect -> emptyList()
        q.allowsText -> choices(sessionId, q, MAX_ACTIONS - 1) + reply(sessionId, q.id)
        else -> choices(sessionId, q, MAX_ACTIONS)
    }

    private fun choices(sessionId: String, q: Pending.Question, max: Int) =
        q.options.take(max).mapIndexed { index, option ->
            choice(sessionId, q.id, index, option.label)
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

    /**
     * Inline reply. With [pendingId] the text answers that question; without it, it is typed into
     * the session followed by Enter.
     */
    private fun reply(sessionId: String, pendingId: String? = null): NotificationCompat.Action {
        val input = RemoteInput.Builder(NotificationActions.REMOTE_INPUT_KEY)
            .setLabel("Reply")
            .build()
        val replyIntent = actionIntent(NotificationActions.ACTION_REPLY, sessionId)
        if (pendingId != null) replyIntent.putExtra(NotificationActions.EXTRA_PENDING, pendingId)
        // Mutable: Android writes the typed text into the intent.
        val intent = broadcast(sessionId, "reply", replyIntent, mutable = true)
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

    /**
     * Opens `afk://session/<id>`. Without a task the app starts and reads the link at creation; an
     * existing task is brought forward, cleared above its activity, which gets the link through
     * `onNewIntent`.
     */
    private fun openSession(sessionId: String): PendingIntent? {
        val link = Uri.Builder().scheme("afk").authority("session").appendPath(sessionId).build()
        val intent = Intent(Intent.ACTION_VIEW, link, context, MainActivity::class.java)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
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
        /**
         * The app's status-bar glyph, white on transparent. Not const: the R class's ids are not
         * compile-time constants.
         */
        val SMALL_ICON = R.drawable.ic_stat_afk

        private const val EVENT_NEEDS_INPUT = "needs_input"
        private const val EVENT_FINISHED = "finished"
        internal const val EVENT_SUBAGENT_FINISHED = "subagent_finished"

        /** Android shows at most three action buttons; a notification carries no more. */
        private const val MAX_ACTIONS = 3
    }
}
