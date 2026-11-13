package io.github.amaankhan63.afk.data.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import io.github.amaankhan63.afk.data.InMemoryDataStore
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.ui.session.DEFAULT_STRIP_CHIPS
import io.github.amaankhan63.afk.ui.session.StripChip
import io.github.amaankhan63.afk.ui.theme.AfkThemeId
import io.github.amaankhan63.afk.ui.theme.ThemeMode
import java.io.File
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The store's [AppSettingsStore.settings] follows the file a moment after each write, so the tests
 * wait for the change they expect; one that never comes fails on the timeout.
 */
@OptIn(ExperimentalCoroutinesApi::class) // runCurrent, advanceTimeBy
class AppSettingsStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    /** File-backed; its actor runs in [TestScope.backgroundScope], so it ends with the test. */
    private fun TestScope.dataStore(): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(scope = backgroundScope) {
            File(tmp.root, "afk_prefs.preferences_pb")
        }

    private fun TestScope.store(dataStore: DataStore<Preferences>) =
        AppSettingsStore(dataStore, backgroundScope)

    @Test fun defaultsMatchSpec() = runTest(timeout = TIMEOUT) {
        val defaults = AppSettings()
        assertEquals(AfkThemeId.Graphite, defaults.theme)
        assertEquals(ThemeMode.System, defaults.mode)
        assertFalse(defaults.alwaysDarkTerminal)
        assertEquals(DEFAULT_STRIP_CHIPS, defaults.stripChips)
        assertEquals(NotificationPrefs(needsInput = true, finished = true), defaults.notifications)
        assertFalse(defaults.notifications.subagents)
        assertEquals(12, defaults.terminalFontSp)
        assertEquals(true, defaults.keyBar)
        assertEquals(true, defaults.wordSuggestions)

        // An empty file reads as the defaults: saving what was read writes them out.
        val dataStore = dataStore()
        val store = store(dataStore)
        store.update { it }
        val prefs = dataStore.data.first()
        assertEquals("Graphite", prefs[stringPreferencesKey("settings.theme")])
        assertEquals("System", prefs[stringPreferencesKey("settings.mode")])
        assertEquals(false, prefs[booleanPreferencesKey("settings.alwaysDarkTerminal")])
        assertEquals(
            "Model,Thinking,CtxUsed,Cost,FiveHour,SessionTime",
            prefs[stringPreferencesKey("settings.stripChips")]
        )
        assertEquals(true, prefs[booleanPreferencesKey("settings.notif.needsInput")])
        assertEquals(true, prefs[booleanPreferencesKey("settings.notif.finished")])
        assertEquals(false, prefs[booleanPreferencesKey("settings.notif.subagents")])
        assertEquals(12, prefs[intPreferencesKey("settings.terminalFontSp")])
        assertEquals(true, prefs[booleanPreferencesKey("settings.keyBar")])
        assertEquals(true, prefs[booleanPreferencesKey("settings.wordSuggestions")])
        assertEquals(defaults, store.settings.value)
    }

    @Test fun roundTripsTheme() = runTest(timeout = TIMEOUT) {
        val dataStore = dataStore()
        val changed = AppSettings(
            theme = AfkThemeId.Ember,
            mode = ThemeMode.Dark,
            alwaysDarkTerminal = true,
            notifications = NotificationPrefs(needsInput = false, subagents = true),
            terminalFontSp = 16,
            keyBar = false,
            wordSuggestions = false
        )
        store(dataStore).update { changed }

        assertEquals(changed, store(dataStore).settings.first { it != AppSettings() })
    }

    @Test fun chipsRoundTripInOrderAndDropUnknownNames() = runTest(timeout = TIMEOUT) {
        val dataStore = dataStore()
        val store = store(dataStore)
        val picked = listOf(StripChip.Cost, StripChip.Model, StripChip.TokensInOut)

        store.update { it.copy(stripChips = picked) }
        val shown = store.settings.first { it.stripChips != DEFAULT_STRIP_CHIPS }
        assertEquals(picked, shown.stripChips)

        // None picked stays none, rather than going back to the defaults.
        store.update { it.copy(stripChips = emptyList()) }
        val none = store.settings.first { it.stripChips != picked }
        assertEquals(emptyList<StripChip>(), none.stripChips)

        dataStore.edit {
            it[stringPreferencesKey("settings.stripChips")] = "SessionTime,Bogus,Model"
        }
        assertEquals(
            listOf(StripChip.SessionTime, StripChip.Model),
            store.settings.first { it.stripChips.isNotEmpty() }.stripChips
        )
    }

    @Test fun fontClampsOnRead() = runTest(timeout = TIMEOUT) {
        val dataStore = dataStore()
        val store = store(dataStore)
        val font = intPreferencesKey("settings.terminalFontSp")

        dataStore.edit { it[font] = 40 }
        assertEquals(20, store.settings.first { it.terminalFontSp != 12 }.terminalFontSp)

        dataStore.edit { it[font] = 3 }
        assertEquals(10, store.settings.first { it.terminalFontSp != 20 }.terminalFontSp)
    }

    /** The settings share the file with the pairing: writing them leaves the pairing as it was. */
    @Test fun updateKeepsThePairing() = runTest(timeout = TIMEOUT) {
        val dataStore = dataStore()
        val pairing = PairingPayload("100.84.12.9", 2351, "tok_abc")
        PairingStore(dataStore).save(pairing)

        val store = store(dataStore)
        store.update { it.copy(theme = AfkThemeId.Ember) }

        assertEquals(pairing, PairingStore(dataStore).pairing.first())
        assertEquals(AfkThemeId.Ember, store.settings.first { it != AppSettings() }.theme)
    }

    /** A read that fails is tried again a second later, so later writes still show. */
    @Test fun readFailureDoesNotStick() = runTest {
        val dataStore = InMemoryDataStore()
        dataStore.edit { it[stringPreferencesKey("settings.theme")] = "Ember" }
        dataStore.readFailures = 1
        val store = store(dataStore)

        runCurrent()
        assertEquals(AppSettings(), store.settings.value)

        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(AfkThemeId.Ember, store.settings.value.theme)

        store.update { it.copy(mode = ThemeMode.Dark) }
        runCurrent()
        assertEquals(ThemeMode.Dark, store.settings.value.mode)
    }

    @Test fun unknownThemeNameFallsBackToDefault() = runTest(timeout = TIMEOUT) {
        val dataStore = dataStore()
        val store = store(dataStore)

        dataStore.edit {
            it[stringPreferencesKey("settings.theme")] = "Neon"
            it[stringPreferencesKey("settings.mode")] = "Dark"
        }
        // Mode is read from the same write, so its change says the theme was read too.
        val read = store.settings.first { it.mode == ThemeMode.Dark }
        assertEquals(AfkThemeId.Graphite, read.theme)
    }

    private companion object {
        val TIMEOUT = 10.seconds
    }
}
