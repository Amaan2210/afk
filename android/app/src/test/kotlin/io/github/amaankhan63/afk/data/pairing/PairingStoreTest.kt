package io.github.amaankhan63.afk.data.pairing

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import io.github.amaankhan63.afk.data.InMemoryDataStore
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PairingStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    private val pairing = PairingPayload("100.84.12.9", 2351, "tok_abc")

    /** File-backed; its actor runs in [TestScope.backgroundScope], so it ends with the test. */
    private fun TestScope.dataStore(): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(scope = backgroundScope) {
            File(tmp.root, "afk_prefs.preferences_pb")
        }

    @Test fun emptyStoreYieldsNull() = runTest {
        assertNull(PairingStore(dataStore()).pairing.first())
    }

    @Test fun roundTrips() = runTest {
        val store = PairingStore(dataStore())
        store.save(pairing)
        assertEquals(pairing, store.pairing.first())
    }

    @Test fun saveReplacesTheEarlierPairing() = runTest {
        val store = PairingStore(dataStore())
        store.save(pairing)
        val next = PairingPayload("100.84.12.10", 2350, "tok_def")
        store.save(next)
        assertEquals(next, store.pairing.first())
    }

    @Test fun savesUnderHostPortAndTokenKeys() = runTest {
        val dataStore = dataStore()
        PairingStore(dataStore).save(pairing)
        val prefs = dataStore.data.first()
        assertEquals("100.84.12.9", prefs[stringPreferencesKey("host")])
        assertEquals(2351, prefs[intPreferencesKey("port")])
        assertEquals("tok_abc", prefs[stringPreferencesKey("token")])
    }

    @Test fun clearYieldsNull() = runTest {
        val store = PairingStore(dataStore())
        store.save(pairing)
        store.clear()
        assertNull(store.pairing.first())
    }

    /** For readers in the background, which would crash on the failure. */
    @Test fun pairingOrNoneReadsAFailureAsNoPairing() = runTest {
        val dataStore = InMemoryDataStore()
        val store = PairingStore(dataStore)
        store.save(pairing)
        dataStore.readFailures = 1

        assertNull(store.pairingOrNone.first())
        assertEquals(pairing, store.pairingOrNone.first())
    }

    @Test fun clearKeepsOtherSettings() = runTest {
        val dataStore = dataStore()
        val theme = stringPreferencesKey("theme")
        dataStore.edit { it[theme] = "dark" }
        val store = PairingStore(dataStore)
        store.save(pairing)
        store.clear()
        assertEquals("dark", dataStore.data.first()[theme])
    }
}
