package io.github.amaankhan63.afk.service

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

    /** The id of session [sessionId]'s one notification, which each new event replaces. */
    fun notificationId(sessionId: String): Int = sessionId.hashCode() and 0x7fffffff
}
