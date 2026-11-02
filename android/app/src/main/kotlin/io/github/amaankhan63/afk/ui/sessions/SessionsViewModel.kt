package io.github.amaankhan63.afk.ui.sessions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.sessions.SessionFilter
import io.github.amaankhan63.afk.data.sessions.SessionOrder
import io.github.amaankhan63.afk.data.sessions.SessionSearch
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.data.sessions.StateFilter
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * What the sessions screen shows. [sessions] is filtered, searched and ordered; [counts] counts
 * every session per state chip, whatever the filter and query; [hostname] is the laptop's name
 * from the latest `hello`; [workingSince] holds, per working session id, when it was first seen
 * working.
 */
data class SessionsUiState(
    val sessions: List<Session> = emptyList(),
    val query: String = "",
    val filter: SessionFilter = SessionFilter(),
    val counts: Map<StateFilter, Int> = emptyMap(),
    val stats: Stats? = null,
    val hostname: String? = null,
    val connection: ConnectionState = ConnectionState.Disconnected,
    val workingSince: Map<String, Instant> = emptyMap()
)

/** The sessions list as the screen filters and searches it, and the actions of its cards. */
@HiltViewModel
class SessionsViewModel internal constructor(
    private val repo: SessionsRepository,
    private val clock: () -> Instant
) : ViewModel() {
    @Inject constructor(repo: SessionsRepository) : this(repo, Instant::now)

    private val query = MutableStateFlow("")
    private val filter = MutableStateFlow(SessionFilter())

    // Both live as long as the view model, not the screen's subscription: a screen that comes
    // back while the connection is down still names the laptop, and working sessions keep the
    // time they started.
    private val hostname: StateFlow<String?> = repo.connection
        .filterIsInstance<ConnectionState.Connected>()
        .map { it.hello.daemon.hostname }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val workingSince: StateFlow<Map<String, Instant>> = repo.sessions
        .scan(emptyMap<String, Instant>()) { since, sessions -> since.track(sessions, clock()) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())

    private val mutableErrors = MutableSharedFlow<AfkError>(extraBufferCapacity = 1)

    /** Failures of [kill], [rename] and [resume]. */
    val errors: SharedFlow<AfkError> = mutableErrors.asSharedFlow()

    private val mutableResumed = MutableSharedFlow<String>(extraBufferCapacity = 1)

    /** The id of each session a [resume] started. */
    val resumed: SharedFlow<String> = mutableResumed.asSharedFlow()

    val ui: StateFlow<SessionsUiState> = combine(
        combine(repo.sessions, workingSince, ::Pair),
        combine(query, filter, ::Pair),
        repo.stats,
        repo.connection,
        hostname
    ) { (all, since), (q, f), stats, connection, host ->
        SessionsUiState(
            sessions = SessionOrder.sorted(
                all.filter(f::accepts).filter { SessionSearch.matches(it, q) }
            ),
            query = q,
            filter = f,
            counts = StateFilter.entries.associateWith { state ->
                all.count(SessionFilter(state)::accepts)
            },
            stats = stats,
            hostname = host,
            connection = connection,
            workingSince = since
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), SessionsUiState())

    fun onQuery(q: String) {
        query.value = q
    }

    fun onFilter(f: SessionFilter) {
        filter.value = f
    }

    fun kill(id: String) {
        request { repo.killSession(id) }
    }

    /** The new name shows once the daemon's update for the session arrives. */
    fun rename(id: String, name: String) {
        request { repo.renameSession(id, name) }
    }

    fun resume(id: String) {
        request(onSuccess = { mutableResumed.tryEmit(it) }) { repo.resumeSession(id) }
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
        const val STOP_TIMEOUT_MS = 5_000L

        /**
         * The ids of the working sessions in [sessions], each with the time this map first held
         * it, [now] for those not working before.
         */
        fun Map<String, Instant>.track(sessions: List<Session>, now: Instant) = sessions
            .filter { it.state == SessionState.working }
            .associate { it.id to (this[it.id] ?: now) }

        /** Every repository failure is an [AfkError]; anything else is reported as `internal`. */
        fun Throwable.asAfkError(): AfkError =
            this as? AfkError ?: AfkError("internal", message ?: toString())
    }
}
