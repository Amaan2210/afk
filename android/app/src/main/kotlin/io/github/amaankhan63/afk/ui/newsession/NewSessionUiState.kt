package io.github.amaankhan63.afk.ui.newsession

import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.SessionKind

/**
 * The new-session form. [cwd] is the chosen folder, blank until one is; [flags] holds the ids of
 * the selected [LaunchFlags] chips and [model] the value of the model chip. [recent] and [browse]
 * come from the latest folder listing; [browse] is null until the picker lists a folder, and again
 * once one is picked. [error] is the latest failure, for the screen to show once.
 */
data class NewSessionUiState(
    val cwd: String = "",
    val kind: SessionKind = SessionKind.claude,
    val flags: Set<String> = setOf("skip"),
    val model: String = "",
    val prompt: String = "",
    val recent: List<String> = emptyList(),
    val browse: ServerMessage.FsDirs? = null,
    val starting: Boolean = false,
    val error: String? = null
) {
    /** A folder is chosen and no start is under way. */
    val canStart: Boolean get() = cwd.isNotBlank() && !starting
}
