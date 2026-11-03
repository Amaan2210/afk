package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn

/** How long the thread stays subscribed after its last collector leaves, such as on a rotation. */
private const val STOP_TIMEOUT_MS = 5_000L

/**
 * Thread [threadId] of session [sessionId] as the Chat tab shows it. The thread is subscribed while
 * [events] has collectors and for [STOP_TIMEOUT_MS] after the last one leaves.
 */
class ChatEvents(
    repo: SessionsRepository,
    sessionId: String,
    threadId: String = "main",
    scope: CoroutineScope
) {
    private val mutableError = MutableStateFlow<AfkError?>(null)

    /**
     * Why the daemon refused the thread or stopped answering for it. The thread then stays as last
     * shown until a collector comes back after the stop timeout, which subscribes again and clears
     * this.
     */
    val error: StateFlow<AfkError?> = mutableError.asStateFlow()

    /** The thread's events in order; empty until its first snapshot. */
    val events: StateFlow<List<ChatEvent>> = repo.chat(sessionId, threadId)
        .onStart { mutableError.value = null }
        // Without its seed: a new subscription keeps the events shown until its snapshot lands.
        .scan(emptyList<ChatEvent>(), ChatReducer::apply)
        .drop(1)
        .catch { if (it is AfkError) mutableError.value = it else throw it }
        .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), emptyList())
}
