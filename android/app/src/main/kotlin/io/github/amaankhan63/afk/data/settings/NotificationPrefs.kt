package io.github.amaankhan63.afk.data.settings

/** Which session notifications the user wants, one switch per channel. */
data class NotificationPrefs(
    val needsInput: Boolean = true,
    val finished: Boolean = true,
    val subagents: Boolean = false
)
