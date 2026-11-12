package io.github.amaankhan63.afk.data.protocol

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

// Shared types of AFK protocol v1 (protocol/protocol.md). Enum entries keep the lowercase wire names.

@Serializable
enum class SessionKind { shell, claude, codex }

@Serializable
enum class SessionState { idle, working, needs_input, finished, ended }

@Serializable
data class Session(
    val id: String,
    val name: String,
    val cwd: String,
    val kind: SessionKind,
    val state: SessionState,
    val createdAt: String,
    val lastActivityAt: String,
    val endedAt: String? = null,
    val exitCode: Int? = null,
    val gitBranch: String? = null,
    val agentSessionId: String? = null,
    val lastMessage: String? = null,
    val subagentsRunning: Int = 0,
    val pending: Pending? = null
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
sealed interface Pending {
    @Serializable
    @SerialName("question")
    data class Question(
        val id: String,
        val text: String,
        val multiSelect: Boolean,
        val allowsText: Boolean,
        val options: List<Option>
    ) : Pending

    @Serializable
    data class Option(
        val label: String,
        val description: String? = null,
        val recommended: Boolean = false
    )

    @Serializable
    @SerialName("permission")
    data class Permission(val id: String, val tool: String, val summary: String) : Pending
}

@Serializable
enum class ChatKind { user, assistant, tool, subagent, question, permission, turn }

@Serializable
enum class ToolStatus { running, ok, error }

@Serializable
enum class SubagentStatus { running, done, error }

@Serializable
data class ToolInfo(
    val name: String,
    val summary: String,
    val status: ToolStatus,
    val input: String? = null,
    val result: String? = null
)

@Serializable
data class SubagentInfo(
    val threadId: String,
    val name: String,
    val task: String,
    val status: SubagentStatus,
    val toolUses: Int
)

/** [phase] is `"start"` or `"end"`. */
@Serializable
data class TurnInfo(val phase: String)

@Serializable
data class ChatEvent(
    val id: String,
    val threadId: String,
    val at: String,
    val kind: ChatKind,
    val text: String? = null,
    val tool: ToolInfo? = null,
    val subagent: SubagentInfo? = null,
    val pending: Pending? = null,
    val turn: TurnInfo? = null
)

@Serializable
data class ModelInfo(val id: String, val name: String)

@Serializable
data class Strip(
    val at: String,
    val model: ModelInfo? = null,
    val thinking: String? = null,
    val contextUsedPct: Double? = null,
    val contextSize: Long? = null,
    val costUsd: Double? = null,
    val durationMs: Long? = null,
    val fiveHourPct: Double? = null,
    val sevenDayPct: Double? = null,
    val tokensIn: Long? = null,
    val tokensOut: Long? = null
)

@Serializable
data class Stats(
    val at: String,
    val ramUsedBytes: Long,
    val ramTotalBytes: Long,
    val cpuPercent: Double,
    val keepAwakeActive: Boolean
)

@Serializable
data class DaemonSettings(
    val keepAwake: Boolean = true,
    val keepAwakeGraceMin: Int = 10,
    val retentionHours: Int = 24,
    /** What the owner calls the laptop; null while it goes by the computer's own name. */
    val laptopName: String? = null
)

/** Wire form of `Partial<DaemonSettings>`: only the non-null fields are sent. */
@Serializable
data class DaemonSettingsPatch(
    val keepAwake: Boolean? = null,
    val keepAwakeGraceMin: Int? = null,
    val retentionHours: Int? = null,
    /** Blank gives the laptop its own name back. */
    val laptopName: String? = null
)

@Serializable
data class ClientInfo(val kind: String, val name: String)

@Serializable
data class DaemonInfo(
    val version: String,
    val hostname: String,
    val platform: String,
    val tailscaleIp: String? = null
)

@Serializable
data class DeviceInfo(val id: String, val name: String)

@Serializable
data class DirEntry(val name: String, val path: String)

/** Failure reported by the daemon (an `error` message) or raised by the client; [code] is a protocol error code. */
class AfkError(val code: String, message: String) : Exception(message)
