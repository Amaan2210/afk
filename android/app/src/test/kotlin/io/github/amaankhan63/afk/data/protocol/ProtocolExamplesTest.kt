package io.github.amaankhan63.afk.data.protocol

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertFalse
import org.junit.Assume.assumeTrue
import org.junit.Test

class ProtocolExamplesTest {
    private val serverTypes = setOf(
        "hello", "ack", "error", "sessions.snapshot", "session.updated", "session.removed", "stats",
        "daemon.settings", "pty.snapshot", "pty.data", "pty.resized", "chat.snapshot", "chat.event",
        "strip.update", "notify", "fs.dirs"
    )

    @Test
    fun everyExampleParses() {
        val dir = File("../../protocol/examples")
        assumeTrue(dir.isDirectory)
        dir.listFiles { f -> f.extension == "json" }!!.forEach { f ->
            val type = Json.parseToJsonElement(
                f.readText()
            ).jsonObject["type"]!!.jsonPrimitive.content
            if (type in serverTypes) {
                assertFalse(f.name, AfkJson.decodeServer(f.readText()) is ServerMessage.Unknown)
            } else {
                AfkJson.json.decodeFromString<ClientMessage>(f.readText())
            }
        }
    }
}
