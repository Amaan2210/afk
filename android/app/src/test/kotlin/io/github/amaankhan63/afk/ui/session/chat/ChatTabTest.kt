package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind
import io.github.amaankhan63.afk.data.protocol.Pending
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

    private val question = Pending.Question(
        id = "q_1",
        text = "Which pet?",
        multiSelect = false,
        allowsText = true,
        options = listOf(Pending.Option("Cats"), Pending.Option("Dogs"))
    )

    @Test fun aScrollEndingAtTheBottomPins() {
        assertTrue(nextPinned(wasPinned = false, scrollEnded = true, canScrollForward = false))
        assertTrue(nextPinned(wasPinned = true, scrollEnded = true, canScrollForward = false))
    }

    @Test fun aScrollEndingAboveTheBottomUnpins() {
        assertFalse(nextPinned(wasPinned = true, scrollEnded = true, canScrollForward = true))
    }

    /** An append or a keyboard leaves the list able to scroll on; only a reader's scroll counts. */
    @Test fun nothingButAnEndedScrollMovesThePin() {
        assertTrue(nextPinned(wasPinned = true, scrollEnded = false, canScrollForward = true))
        assertFalse(nextPinned(wasPinned = false, scrollEnded = false, canScrollForward = false))
    }

    @Test fun otherIsOfferedForOneTypedAnswerWithAComposer() {
        assertTrue(offersOther(question, hasComposer = true))
        // The daemon refuses free text on a multi-select question.
        assertFalse(offersOther(question.copy(multiSelect = true), hasComposer = true))
        assertFalse(offersOther(question.copy(allowsText = false), hasComposer = true))
        // A sub-agent's thread has no composer.
        assertFalse(offersOther(question, hasComposer = false))
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
