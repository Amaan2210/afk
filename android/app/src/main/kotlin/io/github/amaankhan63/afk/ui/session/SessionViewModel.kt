package io.github.amaankhan63.afk.ui.session

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.di.StripChipsFlow
import io.github.amaankhan63.afk.service.ForegroundTracker
import io.github.amaankhan63.afk.ui.navigation.Routes
import io.github.amaankhan63.afk.ui.session.chat.ChatEvents
import io.github.amaankhan63.afk.ui.session.terminal.TerminalBridge
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Session [sessionId] as its screen shows it: its terminal, strip and tabs, what the composer and
 * the key bar type into it, and its actions. Failures of the actions go to [errors].
 */
@HiltViewModel
class SessionViewModel internal constructor(
    private val repo: SessionsRepository,
    private val sessionId: String,
    stripChips: Flow<List<StripChip>> = flowOf(DEFAULT_STRIP_CHIPS),
    private val clock: () -> Instant = Instant::now
) : ViewModel() {
    /** [savedStateHandle] holds the session's id as the route's `id`. */
    @Inject constructor(
        savedStateHandle: SavedStateHandle,
        repo: SessionsRepository,
        @StripChipsFlow stripChips: @JvmSuppressWildcards Flow<List<StripChip>>
    ) : this(
        repo,
        checkNotNull(savedStateHandle.get<String>(Routes.ARG_ID)) {
            "The session route has no ${Routes.ARG_ID}"
        },
        stripChips
    )

    /** The session's terminal. It lives as long as the view model, so a rotation keeps it. */
    val bridge = TerminalBridge(repo, sessionId, viewModelScope)

    /** The session's main thread, for the Chat tab. */
    val chat = ChatEvents(repo, sessionId, scope = viewModelScope)

    private val tab = MutableStateFlow(SessionTab.Terminal)
    private val composer = MutableStateFlow("")

    // The session, and when it was first seen working while it is. It lives as long as the view
    // model, not the screen's subscription, so a rotation keeps the time.
    private val tracked: StateFlow<Pair<Session?, Instant?>> = repo.session(sessionId)
        .scan<Session?, Pair<Session?, Instant?>>(null to null) { (_, since), session ->
            session to if (session?.state == SessionState.working) since ?: clock() else null
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null to null)

    // Buffered for the one screen that collects them, also across a rotation and while it shows
    // an earlier one.
    private val errorEvents = Channel<AfkError>(Channel.BUFFERED)
    private val resumedIds = Channel<String>(Channel.BUFFERED)

    /** Failures of [sendLine], [answer], [kill], [rename] and [resume], each shown once. */
    val errors: Flow<AfkError> = errorEvents.receiveAsFlow()

    /** The id of the session a [resume] started, for the screen to open. */
    val resumed: Flow<String> = resumedIds.receiveAsFlow()

    // A resume under way: a second tap meanwhile would start a second session.
    private var resuming = false

    val ui: StateFlow<SessionUiState> = combine(
        combine(tracked, repo.strip(sessionId), repo.stats, ::Triple),
        stripChips,
        tab,
        composer,
        repo.connection
    ) { (watched, strip, stats), chips, selected, text, connection ->
        SessionUiState(
            watched.first,
            strip,
            stats,
            chips,
            selected,
            text,
            connection,
            workingSince = watched.second
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
        SessionUiState(connection = repo.connection.value)
    )

    fun selectTab(t: SessionTab) {
        tab.value = t
    }

    fun onComposer(text: String) {
        composer.value = text
    }

    /**
     * Sends the composer's text, empties the composer and returns true. While a question waits for
     * a typed answer the text answers it, on either tab: typed into the terminal it would be
     * dropped, and its Enter would pick option 1. While another prompt waits (a question without a
     * typed answer, or a permission) nothing is sent, as its Enter would confirm whatever the
     * prompt highlights: the text stays, [errors] says to answer the prompt, and this returns
     * false. Otherwise the text is typed, then Enter. While not connected the text would be
     * dropped, so it stays, [errors] says why, and this returns false.
     */
    fun sendLine(): Boolean {
        if (!connected()) return false
        val session = tracked.value.first
        val question = session?.textQuestion()
        if (session?.pending != null && question == null) {
            errorEvents.trySend(AfkError(ERROR_PROMPT_WAITING, answerPromptHint(tab.value)))
            return false
        }
        val text = composer.value
        composer.value = ""
        if (question != null) {
            answer(question.id, null, text, null)
        } else {
            sendKeys((text + "\r").toByteArray(Charsets.UTF_8))
        }
        return true
    }

    /** Types [bytes] as they are, such as a key bar key's sequence. */
    fun sendKeys(bytes: ByteArray) {
        repo.ptyInput(sessionId, bytes)
    }

    /**
     * Answers prompt [pendingId] and returns true. While not connected nothing goes out: [errors]
     * says so and this returns false. A prompt that changed or is gone is reported, never answered
     * again: part may be typed.
     */
    fun answer(pendingId: String, choices: List<Int>?, text: String?, decision: String?): Boolean {
        if (!connected()) return false
        request(answering = true) {
            repo.answerPending(sessionId, pendingId, choices, text, decision)
        }
        return true
    }

    fun kill() {
        request(call = { repo.killSession(sessionId) })
    }

    /** The new name shows once the daemon's update for the session arrives. */
    fun rename(name: String) {
        request(call = { repo.renameSession(sessionId, name) })
    }

    /** Resumes the ended session as a new one, whose id goes to [resumed]; once at a time. */
    fun resume() {
        if (resuming) return
        resuming = true
        request(onSuccess = { resumedIds.trySend(it) }, call = { repo.resumeSession(sessionId) })
            .invokeOnCompletion { resuming = false }
    }

    /** Shows the terminal at the grid its view last laid out, 80 × 24 before it has; also a retry. */
    fun attachTerminal() {
        bridge.attach(DEFAULT_COLS, DEFAULT_ROWS)
    }

    fun detachTerminal() {
        bridge.detach()
    }

    /** The screen is in front: the session's notifications are not shown. */
    fun onResumed() {
        ForegroundTracker.claim(this, sessionId)
    }

    /** Leaves in front a screen that came to the front meanwhile, such as a sub-agent's thread. */
    fun onPaused() {
        ForegroundTracker.release(this)
    }

    override fun onCleared() {
        bridge.detach()
        ForegroundTracker.release(this)
    }

    /** Whether the app is connected; when it is not, [errors] says so. */
    private fun connected(): Boolean {
        if (repo.connection.value is ConnectionState.Connected) return true
        errorEvents.trySend(AfkError(ERROR_DISCONNECTED, "Not connected"))
        return false
    }

    /**
     * Runs [call]; a success goes to [onSuccess], a failure to [errors]. [answering] says the call
     * answers a prompt.
     */
    private fun <T> request(
        onSuccess: (T) -> Unit = {},
        answering: Boolean = false,
        call: suspend () -> Result<T>
    ): Job = viewModelScope.launch {
        call()
            .onSuccess(onSuccess)
            .onFailure { errorEvents.trySend(it.asAfkError(answering)) }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
        const val DEFAULT_COLS = 80
        const val DEFAULT_ROWS = 24

        /** A Send held back while a prompt the composer cannot answer waits. */
        const val ERROR_PROMPT_WAITING = "prompt_waiting"
    }
}
