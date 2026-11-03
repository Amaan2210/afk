package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind
import io.github.amaankhan63.afk.data.protocol.ToolInfo
import io.github.amaankhan63.afk.data.protocol.ToolStatus
import io.github.amaankhan63.afk.data.sessions.ChatUpdate
import io.github.amaankhan63.afk.data.sessions.chatEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class ChatReducerTest {
    private fun tool(id: String, status: ToolStatus) = ChatEvent(
        id = id,
        threadId = "main",
        at = "2026-10-30T10:00:00.000Z",
        kind = ChatKind.tool,
        tool = ToolInfo(name = "Grep", summary = "\"session\" in src/", status = status)
    )

    @Test fun eventUpsertsById() {
        val a = tool("t1", status = ToolStatus.running)
        val b = a.copy(tool = a.tool!!.copy(status = ToolStatus.ok))
        assertEquals(listOf(b), ChatReducer.apply(listOf(a), ChatUpdate.Event(b)))
    }

    @Test fun upsertKeepsThePlace() {
        val running = tool("t1", status = ToolStatus.running)
        val done = tool("t1", status = ToolStatus.error)
        val before = listOf(chatEvent("e1"), running, chatEvent("e2"))
        val after = ChatReducer.apply(before, ChatUpdate.Event(done))
        assertEquals(listOf(chatEvent("e1"), done, chatEvent("e2")), after)
        assertEquals(listOf(chatEvent("e1"), running, chatEvent("e2")), before)
    }

    @Test fun newEventAppends() {
        val current = listOf(chatEvent("e1"))
        assertEquals(
            listOf(chatEvent("e1"), chatEvent("e2")),
            ChatReducer.apply(current, ChatUpdate.Event(chatEvent("e2")))
        )
    }

    @Test fun snapshotReplaces() {
        val current = listOf(chatEvent("e1"), chatEvent("e2"))
        val snapshot = listOf(chatEvent("e3"))
        assertEquals(snapshot, ChatReducer.apply(current, ChatUpdate.Snapshot(snapshot)))
        assertEquals(
            emptyList<ChatEvent>(),
            ChatReducer.apply(current, ChatUpdate.Snapshot(emptyList()))
        )
    }

    @Test fun unchangedListIsTheSameInstance() {
        val current = listOf(chatEvent("e1"), chatEvent("e2"))
        assertSame(current, ChatReducer.apply(current, ChatUpdate.Event(chatEvent("e2"))))
        assertSame(current, ChatReducer.apply(current, ChatUpdate.Snapshot(current.toList())))
    }
}
