package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import java.time.Instant

/** Folds the daemon's session messages into the sessions it knows, keyed by id. */
object SessionsReducer {
    /** [current] after [msg]; the same map for a message that is not about the session list. */
    fun reduce(current: Map<String, Session>, msg: ServerMessage): Map<String, Session> =
        when (msg) {
            is ServerMessage.SessionsSnapshot -> msg.sessions.associateBy { it.id }
            is ServerMessage.SessionUpdated -> current + (msg.session.id to msg.session)
            is ServerMessage.SessionRemoved -> current - msg.sessionId
            else -> current
        }

    /**
     * The ids of the working sessions in [sessions], each with its time in [since], or [now] for
     * one not working before.
     */
    fun workingSince(
        since: Map<String, Instant>,
        sessions: Collection<Session>,
        now: Instant
    ): Map<String, Instant> = sessions
        .filter { it.state == SessionState.working }
        .associate { it.id to (since[it.id] ?: now) }
}
