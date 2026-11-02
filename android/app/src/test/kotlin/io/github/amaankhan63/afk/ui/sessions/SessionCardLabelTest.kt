package io.github.amaankhan63.afk.ui.sessions

import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.sessions.session
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionCardLabelTest {
    private val now = Instant.parse("2026-10-30T10:14:30Z")

    private fun label(
        state: SessionState,
        lastMessage: String? = null,
        workingSince: Instant? = null,
        kind: SessionKind = SessionKind.claude
    ) = stateLabel(
        session(state = state, kind = kind, lastMessage = lastMessage),
        workingSince,
        now
    )

    @Test fun needsInput() = assertEquals("Needs your input", label(SessionState.needs_input))

    @Test fun finished() {
        assertEquals("Finished", label(SessionState.finished, "Tests pass."))
        assertEquals("Finished", label(SessionState.finished))
    }

    @Test fun finishedWithAQuestion() {
        val asked = "Finished · asked you something"
        assertEquals(asked, label(SessionState.finished, "Should I also update the docs?"))
        assertEquals(asked, label(SessionState.finished, "Merge it?\n"))
    }

    @Test fun workingCountsFromWhenItStarted() {
        val since = Instant.parse("2026-10-30T10:00:00Z")
        assertEquals("Working · 14m", label(SessionState.working, workingSince = since))
        assertEquals("Working", label(SessionState.working))
    }

    @Test fun idleIsAShellPrompt() {
        assertEquals("Shell · idle", label(SessionState.idle, kind = SessionKind.shell))
        // An agent that exited leaves its session idle at the shell prompt, kind unchanged.
        assertEquals("Shell · idle", label(SessionState.idle, kind = SessionKind.claude))
    }

    @Test fun ended() = assertEquals("Ended", label(SessionState.ended))
}
