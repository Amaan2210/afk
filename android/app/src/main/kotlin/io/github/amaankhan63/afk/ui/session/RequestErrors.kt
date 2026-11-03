package io.github.amaankhan63.afk.ui.session

import io.github.amaankhan63.afk.data.protocol.AfkError

private const val PENDING_CHANGED = "pending_changed"
private const val NOT_FOUND = "not_found"
private const val PROMPT_CHANGED = "The prompt changed; check the terminal"

/**
 * This request failure as the screen shows it. Every repository failure is an [AfkError]; anything
 * else is reported as `internal`. A prompt that changed, or one an answer found gone ([answering]
 * and `not_found`, as when a card is tapped after its prompt moved on), says so in words the
 * screen can show.
 */
internal fun Throwable.asAfkError(answering: Boolean): AfkError {
    val error = this as? AfkError ?: AfkError("internal", message ?: toString())
    val stale = error.code == PENDING_CHANGED || (answering && error.code == NOT_FOUND)
    return if (stale) AfkError(error.code, PROMPT_CHANGED) else error
}
