package io.github.amaankhan63.afk.service

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The session whose screen is in front, if any. Its notifications are not shown.
 *
 * Each screen of a session claims it when it resumes and releases it when it pauses, as its own
 * owner. The latest claim still held wins, whatever order the others are released in: a back
 * gesture given up can resume the screen on top before the screen under it pauses, and the
 * session stays in front.
 */
object ForegroundTracker {
    // The claims held, the latest last.
    private val claims = LinkedHashMap<Any, String>()
    private val current = MutableStateFlow<String?>(null)

    /** The session of the latest claim held; null when no screen holds one. */
    val foregroundSessionId: StateFlow<String?> = current.asStateFlow()

    /** [owner]'s screen of session [sessionId] is in front; a claim it held before is replaced. */
    @Synchronized
    fun claim(owner: Any, sessionId: String) {
        claims.remove(owner)
        claims[owner] = sessionId
        current.value = sessionId
    }

    /** [owner]'s screen has left the front; one it never claimed for changes nothing. */
    @Synchronized
    fun release(owner: Any) {
        claims.remove(owner) ?: return
        current.value = claims.values.lastOrNull()
    }
}
