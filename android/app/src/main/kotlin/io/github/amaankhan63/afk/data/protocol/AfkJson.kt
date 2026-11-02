package io.github.amaankhan63.afk.data.protocol

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

object AfkJson {
    val json: Json = Json {
        ignoreUnknownKeys = true
        classDiscriminator = "type"
        encodeDefaults = true
        explicitNulls = false
    }

    /**
     * Decodes one daemon frame. A `type` this app does not know yields [ServerMessage.Unknown].
     * A frame that is not a JSON object, or has no string `type`, throws (a [SerializationException]
     * or an [IllegalArgumentException]); the caller must catch it.
     */
    fun decodeServer(text: String): ServerMessage =
        json.decodeFromString(ServerMessageSerializer, text)

    fun encodeClient(msg: ClientMessage): String =
        json.encodeToString(ClientMessage.serializer(), msg)
}

/** Picks the [ServerMessage] subclass from the `type` field; unknown types fall back to `Unknown`. */
object ServerMessageSerializer : JsonContentPolymorphicSerializer<ServerMessage>(
    ServerMessage::class
) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<ServerMessage> {
        val typeField = element.jsonObject["type"]?.jsonPrimitive
        if (typeField == null ||
            !typeField.isString
        ) {
            throw SerializationException("message has no string type")
        }
        return when (typeField.content) {
            "hello" -> ServerMessage.Hello.serializer()
            "ack" -> ServerMessage.Ack.serializer()
            "error" -> ServerMessage.Error.serializer()
            "sessions.snapshot" -> ServerMessage.SessionsSnapshot.serializer()
            "session.updated" -> ServerMessage.SessionUpdated.serializer()
            "session.removed" -> ServerMessage.SessionRemoved.serializer()
            "stats" -> ServerMessage.StatsMsg.serializer()
            "daemon.settings" -> ServerMessage.DaemonSettingsMsg.serializer()
            "pty.snapshot" -> ServerMessage.PtySnapshot.serializer()
            "pty.data" -> ServerMessage.PtyData.serializer()
            "pty.resized" -> ServerMessage.PtyResized.serializer()
            "chat.snapshot" -> ServerMessage.ChatSnapshot.serializer()
            "chat.event" -> ServerMessage.ChatEventMsg.serializer()
            "strip.update" -> ServerMessage.StripUpdate.serializer()
            "notify" -> ServerMessage.Notify.serializer()
            "fs.dirs" -> ServerMessage.FsDirs.serializer()
            else -> ServerMessage.Unknown.serializer()
        }
    }
}
