package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind
import io.github.amaankhan63.afk.data.protocol.DaemonInfo
import io.github.amaankhan63.afk.data.protocol.DeviceInfo
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState

val HELLO = ServerMessage.Hello(
    protocol = 1,
    daemon = DaemonInfo("0.1.0", "MY-LAPTOP", "win32", "100.84.12.9"),
    device = DeviceInfo("dev_8f3a", "Pixel 8")
)

fun session(
    id: String = "s_1",
    name: String = "app",
    cwd: String = "D:\\projects\\app",
    kind: SessionKind = SessionKind.claude,
    state: SessionState = SessionState.idle,
    lastActivityAt: String = "2026-10-30T10:00:00.000Z",
    gitBranch: String? = null,
    lastMessage: String? = null
) = Session(
    id = id,
    name = name,
    cwd = cwd,
    kind = kind,
    state = state,
    createdAt = "2026-10-30T09:00:00.000Z",
    lastActivityAt = lastActivityAt,
    gitBranch = gitBranch,
    lastMessage = lastMessage
)

fun chatEvent(id: String, text: String = "hello", threadId: String = "main") = ChatEvent(
    id = id,
    threadId = threadId,
    at = "2026-10-30T10:00:00.000Z",
    kind = ChatKind.assistant,
    text = text
)
