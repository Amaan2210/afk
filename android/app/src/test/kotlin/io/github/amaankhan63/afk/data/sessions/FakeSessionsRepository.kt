package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DaemonSettingsPatch
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.ServerMessage.FsDirs
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onSubscription

/**
 * Plays the repository by hand: tests set its flows, push pty and chat updates, and script the
 * replies of its requests (success by default). Every request and message is recorded in order.
 */
class FakeSessionsRepository : SessionsRepository {
    override val connection = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    override val sessions = MutableStateFlow<List<Session>>(emptyList())
    override val stats = MutableStateFlow<Stats?>(null)
    override val daemonSettings = MutableStateFlow<DaemonSettings?>(null)
    override val notifications =
        MutableSharedFlow<ServerMessage.Notify>(extraBufferCapacity = Int.MAX_VALUE)

    data class Create(
        val cwd: String,
        val kind: SessionKind,
        val args: List<String>,
        val name: String?,
        val prompt: String?
    )

    data class Answer(
        val id: String,
        val pendingId: String,
        val choices: List<Int>?,
        val text: String?,
        val decision: String?
    )

    val created = mutableListOf<Create>()
    val killed = mutableListOf<String>()
    val resumed = mutableListOf<String>()
    val renamed = mutableListOf<Pair<String, String>>()
    val answers = mutableListOf<Answer>()
    val listedDirs = mutableListOf<String?>()
    val settingsPatches = mutableListOf<DaemonSettingsPatch>()
    val ptyInputs = mutableListOf<Pair<String, ByteArray>>()
    val ptyResizes = mutableListOf<Triple<String, Int, Int>>()

    /** The bytes of the last [ptyInput], if any. */
    val lastInput: ByteArray? get() = ptyInputs.lastOrNull()?.second

    /** Every terminal subscription [pty] made, in order: session id, cols, rows. */
    val ptySubscriptions = mutableListOf<Triple<String, Int, Int>>()

    var createResult: Result<String> = Result.success("s_new")
    var killResult: Result<Unit> = Result.success(Unit)
    var resumeResult: Result<String> = Result.success("s_resumed")
    var renameResult: Result<Unit> = Result.success(Unit)
    var answerResult: Result<Unit> = Result.success(Unit)
    var listDirsResult: Result<ServerMessage.FsDirs> =
        Result.success(ServerMessage.FsDirs(id = "r1", dirs = emptyList(), recent = emptyList()))
    var settingsResult: Result<DaemonSettings> = Result.success(DaemonSettings())

    /**
     * When true, each [listDirs] waits for its reply in [dirsReply] instead of answering
     * [listDirsResult], so a test can answer listings late and out of order.
     */
    var holdListDirs = false
    private val heldDirs = mutableMapOf<String?, CompletableDeferred<Result<FsDirs>>>()

    /** The reply the held [listDirs] of [path] waits for; complete it to answer. */
    fun dirsReply(path: String?): CompletableDeferred<Result<FsDirs>> =
        heldDirs.getOrPut(path) { CompletableDeferred() }

    /** When set, each [setDaemonSettings] waits for this reply instead of [settingsResult]. */
    var settingsReply: CompletableDeferred<Result<DaemonSettings>>? = null

    /** When set, each [createSession] waits for this reply instead of [createResult]. */
    var createReply: CompletableDeferred<Result<String>>? = null

    /** When set, each [resumeSession] waits for this reply instead of [resumeResult]. */
    var resumeReply: CompletableDeferred<Result<String>>? = null

    /** When set, every subscription [pty] makes fails with it, as when the daemon refuses one. */
    var ptyFailure: AfkError? = null

    /** When set, every subscription [chat] makes fails with it, as when the daemon refuses one. */
    var chatFailure: AfkError? = null

    /** How many subscriptions [chat] has made, failed ones included. */
    var chatSubscriptions = 0

    private val strips = mutableMapOf<String, MutableStateFlow<Strip?>>()
    private val ptys = mutableMapOf<String, MutableSharedFlow<PtyFrame>>()
    private val chats = mutableMapOf<Pair<String, String>, MutableSharedFlow<ChatUpdate>>()

    /** What collectors of session [id]'s terminal receive while connected; it never completes. */
    fun ptyFrames(id: String): MutableSharedFlow<PtyFrame> =
        ptys.getOrPut(id) { MutableSharedFlow(extraBufferCapacity = Int.MAX_VALUE) }

    /** What collectors of thread [threadId] of session [id] receive; it never completes. */
    fun chatUpdates(id: String, threadId: String = "main"): MutableSharedFlow<ChatUpdate> =
        chats.getOrPut(id to threadId) { MutableSharedFlow(extraBufferCapacity = Int.MAX_VALUE) }

    override fun session(id: String): Flow<Session?> =
        sessions.map { list -> list.find { it.id == id } }

    override fun strip(id: String): MutableStateFlow<Strip?> =
        strips.getOrPut(id) { MutableStateFlow(null) }

    /**
     * Subscribes like the real repository: whenever [connection] is up, again after every
     * reconnect, relaying [ptyFrames] meanwhile.
     */
    override fun pty(id: String, cols: Int, rows: Int): Flow<PtyFrame> = channelFlow {
        connection
            .map { it is ConnectionState.Connected }
            .distinctUntilChanged()
            .collectLatest { connected ->
                if (!connected) return@collectLatest
                ptyFailure?.let { throw it }
                ptyFrames(id)
                    .onSubscription { ptySubscriptions += Triple(id, cols, rows) }
                    .collect { send(it) }
            }
    }

    override fun chat(id: String, threadId: String): Flow<ChatUpdate> = flow {
        chatSubscriptions++
        chatFailure?.let { throw it }
        emitAll(chatUpdates(id, threadId))
    }

    override fun ptyInput(id: String, bytes: ByteArray) {
        ptyInputs += id to bytes
    }

    override fun ptyResize(id: String, cols: Int, rows: Int) {
        ptyResizes += Triple(id, cols, rows)
    }

    override suspend fun createSession(
        cwd: String,
        kind: SessionKind,
        args: List<String>,
        name: String?,
        prompt: String?
    ): Result<String> {
        created += Create(cwd, kind, args, name, prompt)
        return createReply?.await() ?: createResult
    }

    override suspend fun killSession(id: String): Result<Unit> {
        killed += id
        return killResult
    }

    override suspend fun resumeSession(id: String): Result<String> {
        resumed += id
        return resumeReply?.await() ?: resumeResult
    }

    override suspend fun renameSession(id: String, name: String): Result<Unit> {
        renamed += id to name
        return renameResult
    }

    override suspend fun answerPending(
        id: String,
        pendingId: String,
        choices: List<Int>?,
        text: String?,
        decision: String?
    ): Result<Unit> {
        answers += Answer(id, pendingId, choices, text, decision)
        return answerResult
    }

    override suspend fun listDirs(path: String?): Result<ServerMessage.FsDirs> {
        listedDirs += path
        return if (holdListDirs) dirsReply(path).await() else listDirsResult
    }

    override suspend fun setDaemonSettings(patch: DaemonSettingsPatch): Result<DaemonSettings> {
        settingsPatches += patch
        return settingsReply?.await() ?: settingsResult
    }
}
