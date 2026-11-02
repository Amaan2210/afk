package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState

/** The state chips of the sessions screen. */
enum class StateFilter { All, NeedsYou, Working, Done }

/** Which sessions the list shows; an empty [agents] set means every kind. */
data class SessionFilter(
    val state: StateFilter = StateFilter.All,
    val agents: Set<SessionKind> = emptySet()
) {
    fun accepts(s: Session): Boolean =
        state.accepts(s.state) && (agents.isEmpty() || s.kind in agents)
}

private fun StateFilter.accepts(state: SessionState): Boolean = when (this) {
    StateFilter.All -> true
    StateFilter.NeedsYou -> state == SessionState.needs_input
    StateFilter.Working -> state == SessionState.working
    StateFilter.Done -> state == SessionState.finished || state == SessionState.ended
}
