package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.SessionState.ended
import io.github.amaankhan63.afk.data.protocol.SessionState.finished
import io.github.amaankhan63.afk.data.protocol.SessionState.idle
import io.github.amaankhan63.afk.data.protocol.SessionState.needs_input
import io.github.amaankhan63.afk.data.protocol.SessionState.working

/** The one order sessions are listed in: what needs the user first, then by latest activity. */
object SessionOrder {
    val rank: Map<SessionState, Int> =
        mapOf(needs_input to 0, finished to 1, working to 2, idle to 3, ended to 4)

    // The daemon writes every timestamp with toISOString() (UTC, fixed width), so text order is
    // time order.
    private val order = compareBy<Session> { rank[it.state] ?: Int.MAX_VALUE }
        .thenByDescending { it.lastActivityAt }

    fun sorted(list: List<Session>): List<Session> = list.sortedWith(order)
}
