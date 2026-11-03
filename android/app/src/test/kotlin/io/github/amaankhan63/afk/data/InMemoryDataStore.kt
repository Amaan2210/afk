package io.github.amaankhan63.afk.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

/** A [DataStore] in memory, so stores built on the app's preferences need no file. */
class InMemoryDataStore : DataStore<Preferences> {
    private val prefs = MutableStateFlow(emptyPreferences())
    override val data: Flow<Preferences> = prefs

    /** What is saved right now. */
    val current: Preferences get() = prefs.value

    override suspend fun updateData(
        transform: suspend (t: Preferences) -> Preferences
    ): Preferences = transform(prefs.value).also { prefs.value = it }
}
