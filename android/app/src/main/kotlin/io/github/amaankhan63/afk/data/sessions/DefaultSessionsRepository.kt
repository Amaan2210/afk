package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.Base64Codec
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DaemonSettingsPatch
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ProducerScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * [SessionsRepository] over [manager]. One collector in [scope] folds the daemon's pushes into
 * state; each `pty` and `chat` collection holds its own subscription.
 */
class DefaultSessionsRepository(private val manager: ConnectionManager, scope: CoroutineScope) :
    SessionsRepository {
    override val connection: StateFlow<ConnectionState> = manager.state

    private val mutableSessions = MutableStateFlow<List<Session>>(emptyList())
    override val sessions: StateFlow<List<Session>> = mutableSessions.asStateFlow()

    private val mutableStats = MutableStateFlow<Stats?>(null)
    override val stats: StateFlow<Stats?> = mutableStats.asStateFlow()

    private val mutableSettings = MutableStateFlow<DaemonSettings?>(null)
    override val daemonSettings: StateFlow<DaemonSettings?> = mutableSettings.asStateFlow()

    private val mutableNotifications =
        MutableSharedFlow<ServerMessage.Notify>(extraBufferCapacity = 64)
    override val notifications: SharedFlow<ServerMessage.Notify> =
        mutableNotifications.asSharedFlow()

    /** The sessions by id. Touched only by the collector. */
    private var byId: Map<String, Session> = emptyMap()
    private val strips = ConcurrentHashMap<String, MutableStateFlow<Strip?>>()

    /** The grid each open terminal asked for last; a re-subscription asks for it again. */
    private val grids = ConcurrentHashMap<String, Grid>()

    /**
     * How many collections hold each daemon subscription, by [PtyKey] or [ChatKey]. The daemon
     * keeps one per session (and thread) per connection, so only the last to end unsubscribes.
     * Guarded by itself.
     */
    private val holders = HashMap<Any, Int>()

    init {
        // Undispatched: listening before this returns, so no push is missed however soon the
        // manager starts.
        scope.launch(start = CoroutineStart.UNDISPATCHED) { manager.incoming.collect(::onPush) }
        // The settings are the connected daemon's: unknown while offline, and a laptop paired
        // next sends its own after its hello.
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            manager.state.collect {
                if (it !is ConnectionState.Connected) mutableSettings.value = null
            }
        }
    }

    override fun session(id: String): Flow<Session?> =
        sessions.map { list -> list.firstOrNull { it.id == id } }.distinctUntilChanged()

    override fun strip(id: String): StateFlow<Strip?> = stripState(id).asStateFlow()

    override fun pty(id: String, cols: Int, rows: Int): Flow<PtyFrame> = subscription(
        key = PtyKey(id),
        subscribe = {
            val grid = grids[id] ?: Grid(cols, rows)
            ClientMessage.PtySubscribe(NO_ID, id, grid.cols, grid.rows)
        },
        frameOf = { it.ptyFrameOf(id) },
        onHold = { grids[id] = Grid(cols, rows) },
        onLastRelease = {
            grids.remove(id)
            manager.send(ClientMessage.PtyUnsubscribe(id))
        }
    )

    override fun chat(id: String, threadId: String): Flow<ChatUpdate> = subscription(
        key = ChatKey(id, threadId),
        subscribe = { ClientMessage.ChatSubscribe(NO_ID, id, threadId) },
        frameOf = { it.chatUpdateOf(id, threadId) },
        onLastRelease = { manager.send(ClientMessage.ChatUnsubscribe(id, threadId)) }
    )

    override fun ptyInput(id: String, bytes: ByteArray) =
        manager.send(ClientMessage.PtyInput(id, Base64Codec.encode(bytes)))

    override fun ptyResize(id: String, cols: Int, rows: Int) {
        grids.computeIfPresent(id) { _, _ -> Grid(cols, rows) }
        manager.send(ClientMessage.PtyResize(id, cols, rows))
    }

    override suspend fun createSession(
        cwd: String,
        kind: SessionKind,
        args: List<String>,
        name: String?,
        prompt: String?
    ): Result<String> = call(ClientMessage.SessionCreate(NO_ID, cwd, kind, args, name, prompt)) {
        (it as? ServerMessage.Ack)?.sessionId
    }

    override suspend fun killSession(id: String): Result<Unit> =
        call(ClientMessage.SessionKill(NO_ID, id), ::acked)

    override suspend fun resumeSession(id: String): Result<String> =
        call(ClientMessage.SessionResume(NO_ID, id)) { (it as? ServerMessage.Ack)?.sessionId }

    override suspend fun renameSession(id: String, name: String): Result<Unit> =
        call(ClientMessage.SessionRename(NO_ID, id, name), ::acked)

    override suspend fun answerPending(
        id: String,
        pendingId: String,
        choices: List<Int>?,
        text: String?,
        decision: String?
    ): Result<Unit> =
        call(ClientMessage.PendingAnswer(NO_ID, id, pendingId, choices, text, decision), ::acked)

    override suspend fun listDirs(path: String?): Result<ServerMessage.FsDirs> =
        call(ClientMessage.FsListDirs(NO_ID, path)) { it as? ServerMessage.FsDirs }

    override suspend fun setDaemonSettings(patch: DaemonSettingsPatch): Result<DaemonSettings> =
        call(ClientMessage.DaemonSettingsSet(NO_ID, patch)) {
            (it as? ServerMessage.DaemonSettingsMsg)?.settings
        }

    private suspend fun onPush(msg: ServerMessage) {
        when (msg) {
            is ServerMessage.SessionsSnapshot -> {
                reduceSessions(msg)
                dropStrips(strips.keys - byId.keys)
            }

            is ServerMessage.SessionRemoved -> {
                reduceSessions(msg)
                dropStrips(listOf(msg.sessionId))
            }

            is ServerMessage.SessionUpdated -> reduceSessions(msg)

            is ServerMessage.StatsMsg -> mutableStats.value = msg.toStats()

            is ServerMessage.DaemonSettingsMsg -> mutableSettings.value = msg.settings

            is ServerMessage.StripUpdate -> stripState(msg.sessionId).value = msg.strip

            is ServerMessage.Notify -> mutableNotifications.emit(msg)

            else -> Unit
        }
    }

    private fun reduceSessions(msg: ServerMessage) {
        byId = SessionsReducer.reduce(byId, msg)
        mutableSessions.value = SessionOrder.sorted(byId.values.toList())
    }

    private fun stripState(id: String): MutableStateFlow<Strip?> =
        strips.computeIfAbsent(id) { MutableStateFlow(null) }

    private fun dropStrips(ids: Collection<String>) {
        for (id in ids) strips.remove(id)?.value = null
    }

    /**
     * One daemon subscription, held while the flow is collected: [subscribe] goes out on every
     * new connection and [frameOf] picks its frames out of `incoming`. Collections of the same
     * [key] share the daemon's subscription: each start runs [onHold], and only the last to end
     * runs [onLastRelease], which unsubscribes. The buffer is unbounded so a slow collector never
     * holds up `incoming`, which carries every reply.
     */
    private fun <T : Any> subscription(
        key: Any,
        subscribe: () -> ClientMessage,
        frameOf: (ServerMessage) -> T?,
        onHold: () -> Unit = {},
        onLastRelease: () -> Unit
    ): Flow<T> = channelFlow {
        hold(key, onHold)
        try {
            manager.state
                .map { it is ConnectionState.Connected }
                .distinctUntilChanged()
                .collectLatest { connected -> if (connected) relay(subscribe(), frameOf) }
        } finally {
            release(key, onLastRelease)
        }
    }.buffer(Channel.UNLIMITED)

    /** Counts one more collection of [key] and runs [onHold], both under the [holders] lock. */
    private fun hold(key: Any, onHold: () -> Unit) {
        synchronized(holders) {
            holders[key] = (holders[key] ?: 0) + 1
            onHold()
        }
    }

    /**
     * Counts one collection of [key] less; the last one runs [onLastRelease] under the same lock,
     * so a collection starting meanwhile subscribes only after the unsubscribe has gone out.
     */
    private fun release(key: Any, onLastRelease: () -> Unit) {
        synchronized(holders) {
            val left = (holders[key] ?: 1) - 1
            if (left > 0) {
                holders[key] = left
                return
            }
            holders.remove(key)
            onLastRelease()
        }
    }

    /**
     * Subscribes with [request] on the current connection and forwards its frames until
     * cancelled. Frames before the snapshot that answers [request] belong to an earlier
     * subscription and are dropped. A connection lost before the reply returns quietly: the next
     * one subscribes again.
     */
    private suspend fun <T : Any> ProducerScope<T>.relay(
        request: ClientMessage,
        frameOf: (ServerMessage) -> T?
    ) = coroutineScope {
        // Undispatched: listening before the request goes out, so the snapshot right behind the
        // ack is not missed.
        val reader = launch(start = CoroutineStart.UNDISPATCHED) {
            var started = false
            manager.incoming.collect { msg ->
                val frame = frameOf(msg) ?: return@collect
                if (msg.isSnapshot) started = true
                if (started) send(frame)
            }
        }
        val reply = try {
            ask(request)
        } catch (e: AfkError) {
            if (e.code == ERROR_TIMEOUT) throw e
            reader.cancel()
            return@coroutineScope
        }
        if (reply is ServerMessage.Error) throw AfkError(reply.code, reply.message)
    }

    /** Sends [msg]; [read] takes the result out of the reply, or null when it holds none. */
    private suspend fun <T : Any> call(msg: ClientMessage, read: (ServerMessage) -> T?): Result<T> {
        val reply = try {
            ask(msg)
        } catch (e: AfkError) {
            return Result.failure(e)
        }
        if (reply is ServerMessage.Error) return Result.failure(AfkError(reply.code, reply.message))
        val result = read(reply) ?: return Result.failure(
            AfkError(ERROR_INTERNAL, "unexpected reply to ${msg::class.simpleName}")
        )
        return Result.success(result)
    }

    /** [ConnectionManager.request], its timeout turned into [AfkError] ([ERROR_TIMEOUT]). */
    private suspend fun ask(msg: ClientMessage): ServerMessage = try {
        manager.request(msg)
    } catch (e: TimeoutCancellationException) {
        // A caller cancelled by its own timeout is cancelled, not timed out.
        currentCoroutineContext().ensureActive()
        throw AfkError(ERROR_TIMEOUT, "the daemon did not answer in time")
    }

    private data class Grid(val cols: Int, val rows: Int)

    private data class PtyKey(val id: String)

    private data class ChatKey(val id: String, val threadId: String)

    private companion object {
        /** `request` stamps its own id over this placeholder. */
        const val NO_ID = ""
        const val ERROR_INTERNAL = "internal"
    }
}

private fun acked(reply: ServerMessage): Unit? = if (reply is ServerMessage.Ack) Unit else null

private val ServerMessage.isSnapshot: Boolean
    get() = this is ServerMessage.PtySnapshot || this is ServerMessage.ChatSnapshot
