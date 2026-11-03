package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DaemonSettingsPatch
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.protocol.Strip
import java.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/** [AfkError] code of a request the daemon did not answer in time. */
const val ERROR_TIMEOUT = "timeout"

/**
 * The daemon's state as every screen reads it, and the requests screens make. Every
 * `Result.failure` carries an [AfkError] whose code is a protocol error code, [ERROR_TIMEOUT], or
 * `disconnected`.
 */
interface SessionsRepository {
    val connection: StateFlow<ConnectionState>

    /** Every session in [SessionOrder]; the last known list while disconnected. */
    val sessions: StateFlow<List<Session>>

    /**
     * When each working session in [sessions] started working, by id: from the first list that
     * shows it working, so one already working when the app first hears of it counts from then.
     * A session leaves the map when it stops working. The list and the session screen both read
     * it, so they count alike.
     */
    val workingSince: StateFlow<Map<String, Instant>>
    val stats: StateFlow<Stats?>

    /** The connected daemon's settings; null until they arrive and while not connected. */
    val daemonSettings: StateFlow<DaemonSettings?>
    val notifications: SharedFlow<ServerMessage.Notify>

    /** Session [id] as it changes; null while the list does not hold it. */
    fun session(id: String): Flow<Session?>

    /** Session [id]'s latest status-line strip; null until one arrives and after it is removed. */
    fun strip(id: String): StateFlow<Strip?>

    /**
     * Session [id]'s terminal at [cols] × [rows]. Collecting subscribes, and subscribes again
     * whenever the connection comes back; every subscription starts with a [PtyFrame.Snapshot].
     * Fails with [AfkError] when the daemon refuses the subscription or does not answer it.
     * Collectors of the same session may overlap: they share the daemon's one subscription, each
     * new one makes the daemon send a fresh snapshot to all of them, and the last to end
     * unsubscribes.
     */
    fun pty(id: String, cols: Int, rows: Int): Flow<PtyFrame>

    /** Thread [threadId] of session [id], held like [pty]; starts with a [ChatUpdate.Snapshot]. */
    fun chat(id: String, threadId: String = "main"): Flow<ChatUpdate>

    /** Types [bytes] into session [id]; dropped while disconnected. */
    fun ptyInput(id: String, bytes: ByteArray)

    /** Resizes session [id]'s terminal; later re-subscriptions of open [pty]s ask for this grid. */
    fun ptyResize(id: String, cols: Int, rows: Int)

    /** The new session's id. Its final name arrives in [sessions] and can carry a `-2` suffix. */
    suspend fun createSession(
        cwd: String,
        kind: SessionKind,
        args: List<String>,
        name: String?,
        prompt: String?
    ): Result<String>

    suspend fun killSession(id: String): Result<Unit>

    /** The id of the new session that resumes ended session [id]. */
    suspend fun resumeSession(id: String): Result<String>

    /** Its final name arrives in [sessions] and can carry a `-2` suffix. */
    suspend fun renameSession(id: String, name: String): Result<Unit>

    /**
     * Answers pending prompt [pendingId]. A `pending_changed` failure means part of the answer may
     * have been typed: show the session's current state, never retry.
     */
    suspend fun answerPending(
        id: String,
        pendingId: String,
        choices: List<Int>? = null,
        text: String? = null,
        decision: String? = null
    ): Result<Unit>

    /** The folders in [path]; a null path lists the drives. */
    suspend fun listDirs(path: String?): Result<ServerMessage.FsDirs>

    suspend fun setDaemonSettings(patch: DaemonSettingsPatch): Result<DaemonSettings>
}
