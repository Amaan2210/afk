package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ServerMessage

/** One update of a chat thread. */
sealed interface ChatUpdate {
    /** The thread so far; replaces every event shown before. */
    data class Snapshot(val events: List<ChatEvent>) : ChatUpdate

    /** A new event, or a newer version of the shown event with the same `id` (an upsert). */
    data class Event(val event: ChatEvent) : ChatUpdate
}

/** This message as an update of thread [threadId] of [sessionId]; null if it is not one. */
internal fun ServerMessage.chatUpdateOf(sessionId: String, threadId: String): ChatUpdate? {
    val thread = sessionId to threadId
    return when {
        this is ServerMessage.ChatSnapshot && (this.sessionId to this.threadId) == thread ->
            ChatUpdate.Snapshot(events)

        this is ServerMessage.ChatEventMsg && (this.sessionId to this.threadId) == thread ->
            ChatUpdate.Event(event)

        else -> null
    }
}
