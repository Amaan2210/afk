package io.github.amaankhan63.afk.data.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesTest {
    @Test
    fun decodesHello() {
        val m = AfkJson.decodeServer(
            """{"type":"hello","protocol":1,""" +
                """"daemon":{"version":"0.1.0","hostname":"MY-LAPTOP","platform":"win32"},""" +
                """"device":{"id":"dev_1","name":"Pixel"}}"""
        )
        assertEquals("MY-LAPTOP", (m as ServerMessage.Hello).daemon.hostname)
    }

    @Test
    fun decodesSessionUpdatedWithQuestion() {
        val m = AfkJson.decodeServer(
            """{"type":"session.updated","session":{"id":"s_1","name":"x","cwd":"D:\\x",""" +
                """"kind":"claude","state":"needs_input","createdAt":"2026-10-30T10:00:00Z",""" +
                """"lastActivityAt":"2026-10-30T10:01:00Z","subagentsRunning":0,""" +
                """"pending":{"kind":"question","id":"q1","text":"Which?","multiSelect":false,""" +
                """"allowsText":true,"options":[{"label":"A","recommended":true},{"label":"B"}]}}}"""
        ) as ServerMessage.SessionUpdated
        val q = m.session.pending as Pending.Question
        assertEquals("D:\\x", m.session.cwd)
        assertTrue(q.options[0].recommended)
        assertEquals(SessionState.needs_input, m.session.state)
    }

    @Test
    fun unknownTypeDecodesAsUnknown() {
        val m = AfkJson.decodeServer("""{"type":"pty.hologram","x":1}""")
        assertEquals(ServerMessage.Unknown("pty.hologram"), m)
    }

    @Test
    fun ignoresUnknownFields() {
        val m = AfkJson.decodeServer(
            """{"type":"session.removed","sessionId":"s_1","extra":true}"""
        )
        assertEquals(ServerMessage.SessionRemoved("s_1"), m)
    }

    @Test
    fun statsCarriesFieldsInline() {
        val m = AfkJson.decodeServer(
            """{"type":"stats","at":"t","ramUsedBytes":1,"ramTotalBytes":2,""" +
                """"cpuPercent":3.5,"keepAwakeActive":true}"""
        ) as ServerMessage.StatsMsg
        assertEquals(Stats("t", 1, 2, 3.5, true), m.toStats())
    }

    @Test
    fun encodesAuthWithDiscriminatorFirst() {
        val s = AfkJson.encodeClient(
            ClientMessage.Auth(token = "t", client = ClientInfo("android", "Pixel 8"))
        )
        assertTrue(s.startsWith("""{"type":"auth"""))
        assertTrue(s.contains(""""protocol":1"""))
    }

    /** The kinds of answer not given are left out, not sent as null. */
    @Test
    fun pendingAnswerCarriesOnlyTheAnswerGiven() {
        val s = AfkJson.encodeClient(
            ClientMessage.PendingAnswer("r1", "s_1", "q1", choiceIndices = listOf(0))
        )
        val keys = Json.parseToJsonElement(s).jsonObject.keys
        assertEquals(setOf("type", "id", "sessionId", "pendingId", "choiceIndices"), keys)
    }
}
