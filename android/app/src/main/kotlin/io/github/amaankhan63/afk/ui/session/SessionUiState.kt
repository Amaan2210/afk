package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import io.github.amaankhan63.afk.ui.util.relativeTime
import java.time.Instant

enum class SessionTab { Terminal, Chat }

/**
 * What the session screen shows. [chips] are the strip's chips Settings picked, in order;
 * [workingSince] is when the session was first seen working, while it is.
 */
data class SessionUiState(
    val session: Session? = null,
    val strip: Strip? = null,
    val stats: Stats? = null,
    val chips: List<StripChip> = DEFAULT_STRIP_CHIPS,
    val tab: SessionTab = SessionTab.Terminal,
    val composer: String = "",
    val connection: ConnectionState,
    val workingSince: Instant? = null
) {
    /** The strip's chips that have a value, as text; none, which hides the strip, in a shell. */
    val shownChips: List<String> =
        if (session == null || session.kind == SessionKind.shell) {
            emptyList()
        } else {
            chips.mapNotNull { StripChips.render(it, strip, stats) }
        }

    /** On the Chat tab of an agent session the composer talks to the agent; elsewhere it types. */
    val composerPlaceholder: String =
        if (tab == SessionTab.Chat && session != null && session.kind != SessionKind.shell) {
            "Message ${agentName(session.kind)}…"
        } else {
            "Type, then send as a line…"
        }
}

/**
 * The session's agent and state, `Claude · needs your input`; a working session's time counts
 * from [workingSince] to [now].
 */
internal fun sessionSubtitle(session: Session, workingSince: Instant?, now: Instant): String {
    val since = workingSince?.let { " · ${relativeTime(it, now)}" }.orEmpty()
    val state = when (session.state) {
        SessionState.needs_input -> "needs your input"
        SessionState.finished -> "finished"
        SessionState.working -> "working$since"
        SessionState.idle -> "idle"
        SessionState.ended -> "ended"
    }
    return "${agentName(session.kind)} · $state"
}

internal fun agentName(kind: SessionKind): String = when (kind) {
    SessionKind.claude -> "Claude"
    SessionKind.codex -> "Codex"
    SessionKind.shell -> "Shell"
}
