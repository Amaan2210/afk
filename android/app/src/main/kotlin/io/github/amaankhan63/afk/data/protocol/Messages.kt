package io.github.amaankhan63.afk.data.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Daemon to client messages. `Unknown` stands for any type this app does not know. */
@Serializable(with = ServerMessageSerializer::class)
sealed interface ServerMessage {
    @Serializable
    @SerialName("hello")
    data class Hello(val protocol: Int, val daemon: DaemonInfo, val device: DeviceInfo) :
        ServerMessage

    @Serializable
    @SerialName("ack")
    data class Ack(val id: String, val sessionId: String? = null) : ServerMessage

    @Serializable
    @SerialName("error")
    data class Error(val id: String? = null, val code: String, val message: String) : ServerMessage

    @Serializable
    @SerialName("sessions.snapshot")
    data class SessionsSnapshot(val sessions: List<Session>) : ServerMessage

    @Serializable
    @SerialName("session.updated")
    data class SessionUpdated(val session: Session) : ServerMessage

    @Serializable
    @SerialName("session.removed")
    data class SessionRemoved(val sessionId: String) : ServerMessage

    /** `stats` carries the [Stats] fields inline. */
    @Serializable
    @SerialName("stats")
    data class StatsMsg(
        val at: String,
        val ramUsedBytes: Long,
        val ramTotalBytes: Long,
        val cpuPercent: Double,
        val keepAwakeActive: Boolean
    ) : ServerMessage {
        fun toStats(): Stats = Stats(at, ramUsedBytes, ramTotalBytes, cpuPercent, keepAwakeActive)
    }

    @Serializable
    @SerialName("daemon.settings")
    data class DaemonSettingsMsg(val id: String? = null, val settings: DaemonSettings) :
        ServerMessage

    @Serializable
    @SerialName("pty.snapshot")
    data class PtySnapshot(val sessionId: String, val cols: Int, val rows: Int, val data: String) :
        ServerMessage

    @Serializable
    @SerialName("pty.data")
    data class PtyData(val sessionId: String, val data: String) : ServerMessage

    @Serializable
    @SerialName("pty.resized")
    data class PtyResized(val sessionId: String, val cols: Int, val rows: Int) : ServerMessage

    @Serializable
    @SerialName("chat.snapshot")
    data class ChatSnapshot(
        val sessionId: String,
        val threadId: String,
        val events: List<ChatEvent>
    ) : ServerMessage

    @Serializable
    @SerialName("chat.event")
    data class ChatEventMsg(val sessionId: String, val threadId: String, val event: ChatEvent) :
        ServerMessage

    @Serializable
    @SerialName("strip.update")
    data class StripUpdate(val sessionId: String, val strip: Strip) : ServerMessage

    @Serializable
    @SerialName("notify")
    data class Notify(
        val event: String,
        val sessionId: String,
        val sessionName: String,
        val title: String,
        val body: String,
        val pending: Pending? = null
    ) : ServerMessage

    @Serializable
    @SerialName("fs.dirs")
    data class FsDirs(
        val id: String,
        val path: String? = null,
        val parent: String? = null,
        val dirs: List<DirEntry>,
        val recent: List<String>
    ) : ServerMessage

    /** Any message whose `type` this app does not know. */
    @Serializable
    data class Unknown(val type: String) : ServerMessage
}

/** Client to daemon messages; the `type` discriminator is written first. */
@Serializable
sealed interface ClientMessage {
    @Serializable
    @SerialName("auth")
    data class Auth(val token: String, val protocol: Int = 1, val client: ClientInfo) :
        ClientMessage

    @Serializable
    @SerialName("session.create")
    data class SessionCreate(
        val id: String,
        val cwd: String,
        val kind: SessionKind,
        val args: List<String>,
        val name: String? = null,
        val prompt: String? = null
    ) : ClientMessage

    @Serializable
    @SerialName("session.kill")
    data class SessionKill(val id: String, val sessionId: String) : ClientMessage

    @Serializable
    @SerialName("session.resume")
    data class SessionResume(val id: String, val sessionId: String) : ClientMessage

    @Serializable
    @SerialName("session.rename")
    data class SessionRename(val id: String, val sessionId: String, val name: String) :
        ClientMessage

    @Serializable
    @SerialName("pty.subscribe")
    data class PtySubscribe(val id: String, val sessionId: String, val cols: Int, val rows: Int) :
        ClientMessage

    @Serializable
    @SerialName("pty.unsubscribe")
    data class PtyUnsubscribe(val sessionId: String) : ClientMessage

    @Serializable
    @SerialName("pty.input")
    data class PtyInput(val sessionId: String, val data: String) : ClientMessage

    @Serializable
    @SerialName("pty.resize")
    data class PtyResize(val sessionId: String, val cols: Int, val rows: Int) : ClientMessage

    @Serializable
    @SerialName("chat.subscribe")
    data class ChatSubscribe(val id: String, val sessionId: String, val threadId: String = "main") :
        ClientMessage

    @Serializable
    @SerialName("chat.unsubscribe")
    data class ChatUnsubscribe(val sessionId: String, val threadId: String? = null) : ClientMessage

    /** [decision] is `allow`, `allow_always` or `deny`. */
    @Serializable
    @SerialName("pending.answer")
    data class PendingAnswer(
        val id: String,
        val sessionId: String,
        val pendingId: String,
        val choiceIndices: List<Int>? = null,
        val text: String? = null,
        val decision: String? = null
    ) : ClientMessage

    @Serializable
    @SerialName("fs.listDirs")
    data class FsListDirs(val id: String, val path: String? = null) : ClientMessage

    @Serializable
    @SerialName("daemon.settings.get")
    data class DaemonSettingsGet(val id: String) : ClientMessage

    @Serializable
    @SerialName("daemon.settings.set")
    data class DaemonSettingsSet(val id: String, val settings: DaemonSettingsPatch) : ClientMessage

    // The three device.* messages are CLI-only (local token); kept so the models mirror the whole protocol.
    @Serializable
    @SerialName("device.add")
    data class DeviceAdd(val id: String, val name: String) : ClientMessage

    @Serializable
    @SerialName("device.list")
    data class DeviceList(val id: String) : ClientMessage

    @Serializable
    @SerialName("device.remove")
    data class DeviceRemove(val id: String, val deviceId: String) : ClientMessage
}
