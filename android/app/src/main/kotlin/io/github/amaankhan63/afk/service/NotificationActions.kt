package io.github.amaankhan63.afk.service

import io.github.amaankhan63.afk.data.protocol.ServerMessage

/** The intents a session notification's actions send to [NotificationActionReceiver]. */
object NotificationActions {
    /** Picks option [EXTRA_INDEX] of question [EXTRA_PENDING]. */
    const val ACTION_CHOICE = "io.github.amaankhan63.afk.CHOICE"

    /** Answers permission [EXTRA_PENDING] with [EXTRA_DECISION]. */
    const val ACTION_DECISION = "io.github.amaankhan63.afk.DECISION"

    /** Types the text under [REMOTE_INPUT_KEY] into the session, followed by Enter. */
    const val ACTION_REPLY = "io.github.amaankhan63.afk.REPLY"

    const val EXTRA_SESSION = "session"
    const val EXTRA_PENDING = "pending"
    const val EXTRA_INDEX = "index"
    const val EXTRA_DECISION = "decision"
    const val REMOTE_INPUT_KEY = "afk_reply"

    /**
     * The tag of a session's sub-agent notification. It has the session's [notificationId] but a
     * slot of its own, so a sub-agent's end never replaces the session's question.
     */
    const val SUBAGENT_TAG = "subagent"

    /**
     * The id of session [sessionId]'s notification, which each new event replaces; a sub-agent's
     * end has its own, under [SUBAGENT_TAG].
     */
    fun notificationId(sessionId: String): Int = sessionId.hashCode() and 0x7fffffff

    /** The tag [n]'s notification is posted under, with its session's [notificationId]. */
    fun notificationTag(n: ServerMessage.Notify): String? =
        if (n.event == SessionNotifier.EVENT_SUBAGENT_FINISHED) SUBAGENT_TAG else null
}
