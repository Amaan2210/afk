package io.github.amaankhan63.afk.ui.subagent

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatKind
import io.github.amaankhan63.afk.data.protocol.SubagentInfo
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.ui.navigation.Routes
import io.github.amaankhan63.afk.ui.session.asAfkError
import io.github.amaankhan63.afk.ui.session.chat.ChatEvents
import io.github.amaankhan63.afk.ui.session.chat.subagentProgress
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Sub-agent thread [threadId] of session [sessionId] as its screen shows it: the thread's events,
 * and a title and status from the sub-agent's card on the session's main thread. Failures of
 * [answer] go to [errors].
 */
@HiltViewModel
class SubagentViewModel internal constructor(
    private val repo: SessionsRepository,
    private val sessionId: String,
    private val threadId: String
) : ViewModel() {
    /** [savedStateHandle] holds the route's `id` and `threadId`. */
    @Inject constructor(savedStateHandle: SavedStateHandle, repo: SessionsRepository) : this(
        repo,
        checkNotNull(savedStateHandle.get<String>(Routes.ARG_ID)) {
            "The thread route has no ${Routes.ARG_ID}"
        },
        checkNotNull(savedStateHandle.get<String>(Routes.ARG_THREAD_ID)) {
            "The thread route has no ${Routes.ARG_THREAD_ID}"
        }
    )

    /** The sub-agent's thread, for its Chat list. */
    val chat = ChatEvents(repo, sessionId, threadId, viewModelScope)

    // The main thread, only for the sub-agent's card. The session screen under this one reads it
    // too; the repository shares the daemon's subscription between them.
    private val main = ChatEvents(repo, sessionId, scope = viewModelScope)

    private val card: Flow<SubagentInfo?> = main.events
        .map { events ->
            events.lastOrNull { it.kind == ChatKind.subagent && it.subagent?.threadId == threadId }
                ?.subagent
        }
        .distinctUntilChanged()

    /** The sub-agent's task, else its name, else "Sub-agent" (also until the card is known). */
    val title: StateFlow<String> = card
        .map(::subagentTitle)
        .stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
            subagentTitle(null)
        )

    /**
     * The sub-agent's state and tool count, `running · 5 tool uses`; null until its card is
     * known.
     */
    val status: StateFlow<String?> = card
        .map { it?.let(::subagentProgress) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    private val mutableErrors = MutableSharedFlow<AfkError>(extraBufferCapacity = 1)

    /** Failures of [answer]. */
    val errors: SharedFlow<AfkError> = mutableErrors.asSharedFlow()

    /** A prompt that changed or is gone is reported, never answered again. */
    fun answer(pendingId: String, choices: List<Int>?, text: String?, decision: String?) {
        viewModelScope.launch {
            repo.answerPending(sessionId, pendingId, choices, text, decision)
                .onFailure { mutableErrors.tryEmit(it.asAfkError(answering = true)) }
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
        const val FALLBACK_TITLE = "Sub-agent"

        fun subagentTitle(card: SubagentInfo?): String =
            listOfNotNull(card?.task, card?.name).firstOrNull { it.isNotBlank() } ?: FALLBACK_TITLE
    }
}
