package io.github.amaankhan63.afk.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow

/**
 * A [DataStore] in memory, so stores built on the app's preferences need no file. It can fail as
 * a file can: the next [readFailures] collections of [data] throw, and every write throws while
 * [failWrites] is set.
 */
class InMemoryDataStore : DataStore<Preferences> {
    private val prefs = MutableStateFlow(emptyPreferences())

    var readFailures = 0
    var failWrites = false

    override val data: Flow<Preferences> = flow {
        if (readFailures > 0) {
            readFailures--
            throw IOException("unreadable")
        }
        emitAll(prefs)
    }

    /** What is saved right now. */
    val current: Preferences get() = prefs.value

    override suspend fun updateData(
        transform: suspend (t: Preferences) -> Preferences
    ): Preferences {
        if (failWrites) throw IOException("unwritable")
        return transform(prefs.value).also { prefs.value = it }
    }
}
