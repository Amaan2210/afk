package io.github.amaankhan63.afk.service

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The session whose screen is in front, if any. Its notifications are not shown. */
object ForegroundTracker {
    private val current = MutableStateFlow<String?>(null)
    val foregroundSessionId: StateFlow<String?> = current.asStateFlow()

    /** Called with the session's id when its screen resumes and with null when it pauses. */
    fun set(id: String?) {
        current.value = id
    }
}
