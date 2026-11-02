package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.SessionState.ended
import io.github.amaankhan63.afk.data.protocol.SessionState.finished
import io.github.amaankhan63.afk.data.protocol.SessionState.idle
import io.github.amaankhan63.afk.data.protocol.SessionState.needs_input
import io.github.amaankhan63.afk.data.protocol.SessionState.working
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionOrderTest {
    @Test fun needsInputFirstThenFinishedWorkingIdleEnded() {
        val states = listOf(ended, idle, working, finished, needs_input)
        val sorted = SessionOrder.sorted(
            states.mapIndexed { i, st ->
                session("s$i", state = st, lastActivityAt = "2026-10-30T10:00:0${i}Z")
            }
        )
        assertEquals(listOf(needs_input, finished, working, idle, ended), sorted.map { it.state })
    }

    @Test fun stateOutranksActivity() {
        // Newest first by time would put these in exactly the reverse order.
        val states = listOf(needs_input, finished, working, idle, ended)
        val sorted = SessionOrder.sorted(
            states.mapIndexed { i, st ->
                session("s$i", state = st, lastActivityAt = "2026-10-30T10:00:0${i}Z")
            }
        )
        assertEquals(states, sorted.map { it.state })
    }

    @Test fun tiesByLastActivityDescending() {
        val older = session("s_old", state = idle, lastActivityAt = "2026-10-30T10:00:00.000Z")
        val newer = session("s_new", state = idle, lastActivityAt = "2026-10-30T11:00:00.000Z")
        val sorted = SessionOrder.sorted(listOf(older, newer))
        assertEquals(listOf("s_new", "s_old"), sorted.map { it.id })
    }

    @Test fun everyStateHasARank() = assertEquals(
        SessionState.entries.toSet(),
        SessionOrder.rank.keys
    )
}
