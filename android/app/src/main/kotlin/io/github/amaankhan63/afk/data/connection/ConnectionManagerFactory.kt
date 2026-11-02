package io.github.amaankhan63.afk.data.connection

import kotlinx.coroutines.CoroutineScope

/** Makes a fresh [ConnectionManager] that does its work in [scope]. */
fun interface ConnectionManagerFactory {
    /** A manager whose collectors live as long as [scope]: stop it, then cancel the scope. */
    fun create(scope: CoroutineScope): ConnectionManager
}
