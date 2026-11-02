package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DaemonSettingsPatch
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

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

    var createResult: Result<String> = Result.success("s_new")
    var killResult: Result<Unit> = Result.success(Unit)
    var resumeResult: Result<String> = Result.success("s_resumed")
    var renameResult: Result<Unit> = Result.success(Unit)
    var answerResult: Result<Unit> = Result.success(Unit)
    var listDirsResult: Result<ServerMessage.FsDirs> =
        Result.success(ServerMessage.FsDirs(id = "r1", dirs = emptyList(), recent = emptyList()))
    var settingsResult: Result<DaemonSettings> = Result.success(DaemonSettings())

    private val strips = mutableMapOf<String, MutableStateFlow<Strip?>>()
    private val ptys = mutableMapOf<String, MutableSharedFlow<PtyFrame>>()
    private val chats = mutableMapOf<Pair<String, String>, MutableSharedFlow<ChatUpdate>>()

    /** What collectors of session [id]'s terminal receive; it never completes. */
    fun ptyFrames(id: String): MutableSharedFlow<PtyFrame> =
        ptys.getOrPut(id) { MutableSharedFlow(extraBufferCapacity = Int.MAX_VALUE) }

    /** What collectors of thread [threadId] of session [id] receive; it never completes. */
    fun chatUpdates(id: String, threadId: String = "main"): MutableSharedFlow<ChatUpdate> =
        chats.getOrPut(id to threadId) { MutableSharedFlow(extraBufferCapacity = Int.MAX_VALUE) }

    override fun session(id: String): Flow<Session?> =
        sessions.map { list -> list.find { it.id == id } }

    override fun strip(id: String): MutableStateFlow<Strip?> =
        strips.getOrPut(id) { MutableStateFlow(null) }

    override fun pty(id: String, cols: Int, rows: Int): Flow<PtyFrame> = ptyFrames(id)

    override fun chat(id: String, threadId: String): Flow<ChatUpdate> = chatUpdates(id, threadId)

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
        return createResult
    }

    override suspend fun killSession(id: String): Result<Unit> {
        killed += id
        return killResult
    }

    override suspend fun resumeSession(id: String): Result<String> {
        resumed += id
        return resumeResult
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
        return listDirsResult
    }

    override suspend fun setDaemonSettings(patch: DaemonSettingsPatch): Result<DaemonSettings> {
        settingsPatches += patch
        return settingsResult
    }
}
