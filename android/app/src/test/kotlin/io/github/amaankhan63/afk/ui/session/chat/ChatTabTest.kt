package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind
import io.github.amaankhan63.afk.data.protocol.SubagentInfo
import io.github.amaankhan63.afk.data.protocol.SubagentStatus
import io.github.amaankhan63.afk.data.protocol.TurnInfo
import io.github.amaankhan63.afk.data.sessions.chatEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The decisions the Chat tab's composables make, as plain functions. */
class ChatTabTest {
    private fun turn(id: String, phase: String?) = ChatEvent(
        id = id,
        threadId = "main",
        at = "2026-10-30T10:00:00.000Z",
        kind = ChatKind.turn,
        turn = phase?.let { TurnInfo(it) }
    )

    @Test fun followsAnAppendWhenTheLastItemWasShown() {
        // The new item not laid out yet, or laid out below the screen, or partly on it.
        assertTrue(shouldFollow(previousLast = 4, last = 5, lastVisible = 4))
        assertTrue(shouldFollow(previousLast = 4, last = 5, lastVisible = 5))
    }

    @Test fun firstEventsScrollToTheEnd() {
        assertTrue(shouldFollow(previousLast = -1, last = 9, lastVisible = -1))
    }

    @Test fun neverFightsAReaderWhoScrolledUp() {
        assertFalse(shouldFollow(previousLast = 4, last = 5, lastVisible = 2))
    }

    @Test fun onlyAnAppendFollows() {
        // An upsert in place, and a snapshot with fewer events.
        assertFalse(shouldFollow(previousLast = 4, last = 4, lastVisible = 4))
        assertFalse(shouldFollow(previousLast = 4, last = 2, lastVisible = 4))
    }

    @Test fun turnStartsHaveARowAndTurnEndsNone() {
        assertTrue(hasRow(turn("t1", "start")))
        assertFalse(hasRow(turn("t2", "end")))
        assertFalse(hasRow(turn("t3", null)))
        assertTrue(hasRow(chatEvent("e1")))
    }

    @Test fun subagentMetaCountsToolUses() {
        val info = SubagentInfo("t_1", "Explore", "find auth code", SubagentStatus.done, 5)
        assertEquals("Sub-agent · done · 5 tool uses", subagentMeta(info))
        assertEquals(
            "Sub-agent · running · 1 tool use",
            subagentMeta(info.copy(status = SubagentStatus.running, toolUses = 1))
        )
        assertEquals(
            "Sub-agent · error · 0 tool uses",
            subagentMeta(info.copy(status = SubagentStatus.error, toolUses = 0))
        )
    }
}
