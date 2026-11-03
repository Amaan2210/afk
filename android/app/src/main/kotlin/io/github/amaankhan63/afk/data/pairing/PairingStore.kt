package io.github.amaankhan63.afk.data.pairing

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** The saved pairing, kept under the keys `host`, `port` and `token` of the app's preferences. */
class PairingStore @Inject constructor(private val dataStore: DataStore<Preferences>) {
    /** The saved pairing, or null while the app is not paired. */
    val pairing: Flow<PairingPayload?> = dataStore.data
        .map { prefs ->
            val host = prefs[HOST]
            val token = prefs[TOKEN]
            if (host.isNullOrBlank() || token.isNullOrBlank()) {
                null
            } else {
                PairingPayload(host, prefs[PORT] ?: 2350, token)
            }
        }
        .distinctUntilChanged()

    /**
     * [pairing], with preferences that cannot be read counted as no pairing, which then ends the
     * flow. For readers that start the connection in the background, where a failure would crash
     * the app: the connection service, the boot receiver, the activity starting the service.
     */
    val pairingOrNone: Flow<PairingPayload?> =
        pairing.catch { if (it is IOException) emit(null) else throw it }

    suspend fun save(p: PairingPayload) {
        dataStore.edit {
            it[HOST] = p.host
            it[PORT] = p.port
            it[TOKEN] = p.token
        }
    }

    /** Forgets the pairing; other preferences stay. */
    suspend fun clear() {
        dataStore.edit {
            it.remove(HOST)
            it.remove(PORT)
            it.remove(TOKEN)
        }
    }

    private companion object {
        val HOST = stringPreferencesKey("host")
        val PORT = intPreferencesKey("port")
        val TOKEN = stringPreferencesKey("token")
    }
}
