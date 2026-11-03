package io.github.amaankhan63.afk.ui.sessions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.sessions.SessionFilter
import io.github.amaankhan63.afk.data.sessions.SessionOrder
import io.github.amaankhan63.afk.data.sessions.SessionSearch
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.data.sessions.StateFilter
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * What the sessions screen shows. [sessions] is filtered, searched and ordered; [counts] counts
 * every session per state chip, whatever the filter and query; [hostname] is the laptop's name
 * from the latest `hello`; [workingSince] holds, per working session id, when it started working
 * ([SessionsRepository.workingSince]); [allSessions] is every session, unfiltered, as the
 * repository lists them;
 * [pairingHost] is the host the app was paired with.
 */
data class SessionsUiState(
    val sessions: List<Session> = emptyList(),
    val query: String = "",
    val filter: SessionFilter = SessionFilter(),
    val counts: Map<StateFilter, Int> = emptyMap(),
    val stats: Stats? = null,
    val hostname: String? = null,
    val connection: ConnectionState = ConnectionState.Disconnected,
    val workingSince: Map<String, Instant> = emptyMap(),
    val allSessions: List<Session> = emptyList(),
    val pairingHost: String? = null
)

/** The sessions list as the screen filters and searches it, and the actions of its cards. */
@HiltViewModel
class SessionsViewModel internal constructor(
    private val repo: SessionsRepository,
    pairingHost: Flow<String?> = flowOf(null)
) : ViewModel() {
    @Inject constructor(repo: SessionsRepository, pairingStore: PairingStore) : this(
        repo,
        // A pairing that cannot be read leaves the banner to say "the laptop".
        pairingStore.pairing.catch { emit(null) }.map { it?.host }
    )

    private val query = MutableStateFlow("")
    private val filter = MutableStateFlow(SessionFilter())

    // It lives as long as the view model, not the screen's subscription: a screen that comes
    // back while the connection is down still names the laptop.
    private val hostname: StateFlow<String?> = repo.connection
        .mapNotNull { it.hostname() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, repo.connection.value.hostname())

    // Eager, so the list never waits on the first read of the pairing.
    private val pairedHost: StateFlow<String?> =
        pairingHost.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    // Buffered for the one screen that collects them, also across a rotation and while it shows
    // an earlier one.
    private val errorEvents = Channel<AfkError>(Channel.BUFFERED)
    private val resumedIds = Channel<String>(Channel.BUFFERED)

    /** Failures of [kill], [rename] and [resume], each shown once. */
    val errors: Flow<AfkError> = errorEvents.receiveAsFlow()

    /** The id of each session a [resume] started, for the screen to open. */
    val resumed: Flow<String> = resumedIds.receiveAsFlow()

    // A resume under way: a second tap meanwhile would start a second session.
    private var resuming = false

    val ui: StateFlow<SessionsUiState> = combine(
        combine(repo.sessions, repo.workingSince, ::Pair),
        combine(query, filter, ::Pair),
        repo.stats,
        repo.connection,
        combine(hostname, pairedHost, ::Pair)
    ) { (all, since), (q, f), stats, connection, (host, paired) ->
        uiState(all, since, q, f, stats, connection, host, paired)
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
        // What the repository holds now: a screen opening while connected draws the list at once,
        // not an empty, disconnected one for a frame.
        uiState(
            all = repo.sessions.value,
            since = repo.workingSince.value,
            q = query.value,
            f = filter.value,
            stats = repo.stats.value,
            connection = repo.connection.value,
            host = repo.connection.value.hostname(),
            paired = pairedHost.value
        )
    )

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

    /** Resumes ended session [id] as a new one, whose id goes to [resumed]; once at a time. */
    fun resume(id: String) {
        if (resuming) return
        resuming = true
        request(onSuccess = { resumedIds.trySend(it) }) { repo.resumeSession(id) }
            .invokeOnCompletion { resuming = false }
    }

    /** Runs [call]; a success goes to [onSuccess], a failure to [errors]. */
    private fun <T> request(onSuccess: (T) -> Unit = {}, call: suspend () -> Result<T>): Job =
        viewModelScope.launch {
            call()
                .onSuccess(onSuccess)
                .onFailure { errorEvents.trySend(it.asAfkError()) }
        }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L

        /** The screen's state from each source it combines; [q] is the query, [f] the filter. */
        fun uiState(
            all: List<Session>,
            since: Map<String, Instant>,
            q: String,
            f: SessionFilter,
            stats: Stats?,
            connection: ConnectionState,
            host: String?,
            paired: String?
        ) = SessionsUiState(
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
            workingSince = since,
            allSessions = all,
            pairingHost = paired
        )

        /** The laptop's name, from this connection's `hello`, if it is connected. */
        fun ConnectionState.hostname(): String? =
            (this as? ConnectionState.Connected)?.hello?.daemon?.hostname

        /** Every repository failure is an [AfkError]; anything else is reported as `internal`. */
        fun Throwable.asAfkError(): AfkError =
            this as? AfkError ?: AfkError("internal", message ?: toString())
    }
}
