package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.SessionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class SessionsReducerTest {
    private val one = session("s_1")
    private val two = session("s_2")
    private val current = mapOf("s_1" to one, "s_2" to two)

    @Test fun snapshotReplaces() {
        val three = session("s_3")
        val next = SessionsReducer.reduce(current, ServerMessage.SessionsSnapshot(listOf(three)))
        assertEquals(mapOf("s_3" to three), next)
    }

    @Test fun updatedUpserts() {
        val busy = one.copy(state = SessionState.working)
        val three = session("s_3")
        val updated = SessionsReducer.reduce(current, ServerMessage.SessionUpdated(busy))
        assertEquals(mapOf("s_1" to busy, "s_2" to two), updated)
        val added = SessionsReducer.reduce(updated, ServerMessage.SessionUpdated(three))
        assertEquals(mapOf("s_1" to busy, "s_2" to two, "s_3" to three), added)
    }

    @Test fun removedDrops() {
        val next = SessionsReducer.reduce(current, ServerMessage.SessionRemoved("s_1"))
        assertEquals(mapOf("s_2" to two), next)
        assertEquals(next, SessionsReducer.reduce(next, ServerMessage.SessionRemoved("s_9")))
    }

    @Test fun unrelatedMessageIsNoOp() {
        val msg = ServerMessage.PtyData("s_1", "aGk=")
        assertSame(current, SessionsReducer.reduce(current, msg))
    }
}
