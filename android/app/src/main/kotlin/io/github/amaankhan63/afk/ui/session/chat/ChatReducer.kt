package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.sessions.ChatUpdate

/** Folds a thread's [ChatUpdate]s into the events the Chat tab shows, in the daemon's order. */
object ChatReducer {
    /**
     * A [ChatUpdate.Snapshot] replaces [current]; a [ChatUpdate.Event] replaces the event with its
     * id where it stands, such as a tool's result replacing its running row, or is appended. An
     * update that changes nothing returns [current] itself.
     */
    fun apply(current: List<ChatEvent>, update: ChatUpdate): List<ChatEvent> = when (update) {
        is ChatUpdate.Snapshot -> if (update.events == current) current else update.events
        is ChatUpdate.Event -> upsert(current, update.event)
    }

    private fun upsert(current: List<ChatEvent>, event: ChatEvent): List<ChatEvent> {
        // Ids are unique in a thread, and the latest events are the ones that change.
        val index = current.indexOfLast { it.id == event.id }
        return when {
            index < 0 -> current + event
            current[index] == event -> current
            else -> current.toMutableList().also { it[index] = event }
        }
    }
}
