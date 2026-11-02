package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.sessions.session
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionTopBarTest {
    private val now = Instant.parse("2026-11-02T10:14:30Z")

    private fun subtitle(
        state: SessionState,
        kind: SessionKind = SessionKind.claude,
        workingSince: Instant? = null
    ) = sessionSubtitle(session(kind = kind, state = state), workingSince, now)

    @Test fun subtitleNamesTheAgentThenTheState() {
        assertEquals("Claude · needs your input", subtitle(SessionState.needs_input))
        assertEquals("Codex · finished", subtitle(SessionState.finished, SessionKind.codex))
        assertEquals("Claude · ended", subtitle(SessionState.ended))
    }

    @Test fun idleShellSaysShellOnce() =
        assertEquals("Shell · idle", subtitle(SessionState.idle, SessionKind.shell))

    @Test fun workingCountsFromWhenItStarted() {
        val since = now.minusSeconds(14 * 60)
        assertEquals("Claude · working · 14m", subtitle(SessionState.working, workingSince = since))
        assertEquals("Claude · working", subtitle(SessionState.working))
    }

    @Test fun attachCommandQuotesNamesThatNeedIt() {
        assertEquals("afk attach api-v2.1_x", attachCommand(session(name = "api-v2.1_x")))
        assertEquals("afk attach \"my app\"", attachCommand(session(name = "my app")))
        assertEquals("afk attach \"say \\\"hi\\\"\"", attachCommand(session(name = "say \"hi\"")))
    }
}
