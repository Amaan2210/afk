package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.sessions.ERROR_TIMEOUT
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.retryWhen
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
     * Why the thread cannot be shown. A subscription the daemon did not answer is made again once
     * connected, and this clears when the thread arrives. A refusal is final: the thread stays as
     * last shown until a collector comes back after the stop timeout, which subscribes again and
     * clears this.
     */
    val error: StateFlow<AfkError?> = mutableError.asStateFlow()

    /** The thread's events in order; null until its first snapshot. */
    val events: StateFlow<List<ChatEvent>?> = repo.chat(sessionId, threadId)
        .onEach { mutableError.value = null }
        // Without its seed: a new subscription keeps the events shown until its snapshot lands.
        .scan(emptyList<ChatEvent>(), ChatReducer::apply)
        .drop(1)
        // The Chat page stays composed beside the terminal, so no new collector would come to
        // subscribe again: an unanswered subscription is made again here, once connected.
        .retryWhen { cause, _ ->
            val timeout = (cause as? AfkError)?.takeIf { it.code == ERROR_TIMEOUT }
                ?: return@retryWhen false
            mutableError.value = timeout
            repo.connection.first { it is ConnectionState.Connected }
            true
        }
        .onStart { mutableError.value = null }
        .catch { if (it is AfkError) mutableError.value = it else throw it }
        .stateIn<List<ChatEvent>?>(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)
}
