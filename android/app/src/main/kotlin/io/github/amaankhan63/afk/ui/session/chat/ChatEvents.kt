package io.github.amaankhan63.afk.ui.session.chat

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.sessions.ERROR_TIMEOUT
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
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

/** The wait before a subscription the daemon did not answer is made again, and its most. */
private const val RETRY_MS = 10_000L
private const val MAX_RETRY_MS = 60_000L

/** The wait before retry number [unanswered] (from 0): [RETRY_MS] doubling up to [MAX_RETRY_MS]. */
internal fun retryDelayMs(unanswered: Int): Long =
    (RETRY_MS shl unanswered.coerceIn(0, 3)).coerceAtMost(MAX_RETRY_MS)

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

    // Subscriptions the daemon did not answer, in a row; each waits longer than the last.
    private var unanswered = 0

    /**
     * Why the thread cannot be shown. A subscription the daemon did not answer is made again once
     * connected, after a wait that grows with each silence ([retryDelayMs]), and this clears when
     * the thread arrives. A refusal is final: the thread stays as last shown until a collector
     * comes back after the stop timeout, which subscribes again and clears this.
     */
    val error: StateFlow<AfkError?> = mutableError.asStateFlow()

    /** The thread's events in order; null until its first snapshot. */
    val events: StateFlow<List<ChatEvent>?> = repo.chat(sessionId, threadId)
        .onEach {
            unanswered = 0
            mutableError.value = null
        }
        // Without its seed: a new subscription keeps the events shown until its snapshot lands.
        .scan(emptyList<ChatEvent>(), ChatReducer::apply)
        .drop(1)
        // The Chat page stays composed beside the terminal, so no new collector would come to
        // subscribe again: an unanswered subscription is made again here, after a wait and once
        // connected. Not at once: while connected, that would ask a silent daemon every timeout.
        .retryWhen { cause, _ ->
            val timeout = (cause as? AfkError)?.takeIf { it.code == ERROR_TIMEOUT }
                ?: return@retryWhen false
            mutableError.value = timeout
            delay(retryDelayMs(unanswered++))
            repo.connection.first { it is ConnectionState.Connected }
            true
        }
        .onStart {
            unanswered = 0
            mutableError.value = null
        }
        .catch { if (it is AfkError) mutableError.value = it else throw it }
        .stateIn<List<ChatEvent>?>(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)
}
