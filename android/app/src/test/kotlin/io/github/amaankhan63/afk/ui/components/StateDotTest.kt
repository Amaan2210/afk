package io.github.amaankhan63.afk.ui.components

import io.github.amaankhan63.afk.data.protocol.SessionState
import org.junit.Assert.assertEquals
import org.junit.Test

class StateDotTest {
    @Test fun everyStateHasAName() {
        val names = SessionState.entries.associateWith(::stateName)
        val expected = mapOf(
            SessionState.needs_input to "Needs your input",
            SessionState.working to "Working",
            SessionState.finished to "Finished",
            SessionState.idle to "Idle",
            SessionState.ended to "Ended"
        )
        assertEquals(expected, names)
    }
}
