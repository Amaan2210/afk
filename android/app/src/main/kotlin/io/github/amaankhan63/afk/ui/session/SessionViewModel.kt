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
import io.github.amaankhan63.afk.ui.session.terminal.TerminalBridge
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
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
        checkNotNull(savedStateHandle.get<String>(ID_KEY)) { "The session route has no $ID_KEY" },
        stripChips
    )

    /** The session's terminal. It lives as long as the view model, so a rotation keeps it. */
    val bridge = TerminalBridge(repo, sessionId, viewModelScope)

    private val tab = MutableStateFlow(SessionTab.Terminal)
    private val composer = MutableStateFlow("")

    // The session, and when it was first seen working while it is. It lives as long as the view
    // model, not the screen's subscription, so a rotation keeps the time.
    private val tracked: StateFlow<Pair<Session?, Instant?>> = repo.session(sessionId)
        .scan<Session?, Pair<Session?, Instant?>>(null to null) { (_, since), session ->
            session to if (session?.state == SessionState.working) since ?: clock() else null
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null to null)

    private val mutableErrors = MutableSharedFlow<AfkError>(extraBufferCapacity = 1)

    /** Failures of [sendLine], [answer], [kill], [rename] and [resume]. */
    val errors: SharedFlow<AfkError> = mutableErrors.asSharedFlow()

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
     * Types the composer's text and Enter, empties the composer and returns true. While not
     * connected the text would be dropped, so it stays, [errors] says why, and this returns false.
     */
    fun sendLine(): Boolean {
        if (repo.connection.value !is ConnectionState.Connected) {
            mutableErrors.tryEmit(AfkError(ERROR_DISCONNECTED, "Not connected"))
            return false
        }
        val line = composer.value + "\r"
        composer.value = ""
        sendKeys(line.toByteArray(Charsets.UTF_8))
        return true
    }

    /** Types [bytes] as they are, such as a key bar key's sequence. */
    fun sendKeys(bytes: ByteArray) {
        repo.ptyInput(sessionId, bytes)
    }

    /** A prompt that changed meanwhile is reported, never answered again: part may be typed. */
    fun answer(pendingId: String, choices: List<Int>?, text: String?, decision: String?) {
        request(call = { repo.answerPending(sessionId, pendingId, choices, text, decision) })
    }

    fun kill() {
        request(call = { repo.killSession(sessionId) })
    }

    /** The new name shows once the daemon's update for the session arrives. */
    fun rename(name: String) {
        request(call = { repo.renameSession(sessionId, name) })
    }

    /** Resumes the ended session as a new one, whose id goes to [onNew]. */
    fun resume(onNew: (String) -> Unit) {
        request(onSuccess = onNew, call = { repo.resumeSession(sessionId) })
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
        ForegroundTracker.set(sessionId)
    }

    fun onPaused() {
        leaveForeground()
    }

    override fun onCleared() {
        bridge.detach()
        leaveForeground()
    }

    /** Leaves alone a session that came to the front meanwhile, such as one a resume opened. */
    private fun leaveForeground() {
        if (ForegroundTracker.foregroundSessionId.value == sessionId) ForegroundTracker.set(null)
    }

    /** Runs [call]; a success goes to [onSuccess], a failure to [errors]. */
    private fun <T> request(onSuccess: (T) -> Unit = {}, call: suspend () -> Result<T>) {
        viewModelScope.launch {
            call()
                .onSuccess(onSuccess)
                .onFailure { mutableErrors.tryEmit(it.asAfkError()) }
        }
    }

    private companion object {
        const val ID_KEY = "id"
        const val STOP_TIMEOUT_MS = 5_000L
        const val DEFAULT_COLS = 80
        const val DEFAULT_ROWS = 24
        const val PENDING_CHANGED = "pending_changed"
        const val PROMPT_CHANGED = "The prompt changed; check the terminal"

        /**
         * Every repository failure is an [AfkError]; anything else is reported as `internal`. A
         * prompt that changed says so in words the screen can show.
         */
        fun Throwable.asAfkError(): AfkError {
            val error = this as? AfkError ?: AfkError("internal", message ?: toString())
            if (error.code != PENDING_CHANGED) return error
            return AfkError(PENDING_CHANGED, PROMPT_CHANGED)
        }
    }
}
