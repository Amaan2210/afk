package io.github.amaankhan63.afk.data.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import io.github.amaankhan63.afk.di.AppScope
import io.github.amaankhan63.afk.ui.session.DEFAULT_STRIP_CHIPS
import io.github.amaankhan63.afk.ui.session.StripChip
import io.github.amaankhan63.afk.ui.theme.AfkThemeId
import io.github.amaankhan63.afk.ui.theme.ThemeMode
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.enums.enumEntries
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.flow.stateIn

/**
 * The app's settings, kept in the app's preferences next to the pairing under keys that start
 * with `settings.`. Enums are saved by name and the strip's chips as their names joined by commas,
 * in order. A value that is missing or not understood reads as its default, a font size out of
 * range as the nearest size allowed.
 *
 * One instance for the app: its [settings] read the file for as long as the app runs.
 */
@Singleton
class AppSettingsStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    @AppScope scope: CoroutineScope
) {
    /**
     * The defaults until the file is read. A read that fails keeps what was read last and is tried
     * again a second later, so the settings follow the file again once it can be read.
     */
    val settings: StateFlow<AppSettings> = dataStore.data
        .map(::decode)
        .retryWhen { cause, _ -> (cause is IOException).also { if (it) delay(READ_RETRY_MS) } }
        .stateIn(scope, SharingStarted.Eagerly, AppSettings())

    /** Saves [transform] of the settings as saved, every field written; a failed write throws. */
    suspend fun update(transform: (AppSettings) -> AppSettings) {
        dataStore.edit { prefs -> encode(transform(decode(prefs)), prefs) }
    }

    private companion object {
        val THEME = stringPreferencesKey("settings.theme")
        val MODE = stringPreferencesKey("settings.mode")
        val ALWAYS_DARK_TERMINAL = booleanPreferencesKey("settings.alwaysDarkTerminal")
        val STRIP_CHIPS = stringPreferencesKey("settings.stripChips")
        val NOTIF_NEEDS_INPUT = booleanPreferencesKey("settings.notif.needsInput")
        val NOTIF_FINISHED = booleanPreferencesKey("settings.notif.finished")
        val NOTIF_SUBAGENTS = booleanPreferencesKey("settings.notif.subagents")
        val TERMINAL_FONT_SP = intPreferencesKey("settings.terminalFontSp")
        val KEY_BAR = booleanPreferencesKey("settings.keyBar")
        val SWIPE_TABS = booleanPreferencesKey("settings.swipeTabs")
        val WORD_SUGGESTIONS = booleanPreferencesKey("settings.wordSuggestions")
        val MUTED_SESSIONS = stringSetPreferencesKey("settings.mutedSessions")

        const val SEPARATOR = ","
        const val READ_RETRY_MS = 1_000L

        fun decode(prefs: Preferences): AppSettings {
            val defaults = AppSettings()
            val notifications = defaults.notifications
            return AppSettings(
                theme = enumNamed(prefs[THEME], defaults.theme),
                mode = enumNamed(prefs[MODE], defaults.mode),
                alwaysDarkTerminal = prefs[ALWAYS_DARK_TERMINAL] ?: defaults.alwaysDarkTerminal,
                stripChips = prefs[STRIP_CHIPS]?.let(::chips) ?: DEFAULT_STRIP_CHIPS,
                notifications = NotificationPrefs(
                    needsInput = prefs[NOTIF_NEEDS_INPUT] ?: notifications.needsInput,
                    finished = prefs[NOTIF_FINISHED] ?: notifications.finished,
                    subagents = prefs[NOTIF_SUBAGENTS] ?: notifications.subagents
                ),
                terminalFontSp = prefs[TERMINAL_FONT_SP]
                    ?.coerceIn(MIN_TERMINAL_FONT_SP, MAX_TERMINAL_FONT_SP)
                    ?: defaults.terminalFontSp,
                keyBar = prefs[KEY_BAR] ?: defaults.keyBar,
                swipeTabs = prefs[SWIPE_TABS] ?: defaults.swipeTabs,
                wordSuggestions = prefs[WORD_SUGGESTIONS] ?: defaults.wordSuggestions,
                mutedSessions = prefs[MUTED_SESSIONS] ?: defaults.mutedSessions
            )
        }

        fun encode(settings: AppSettings, prefs: MutablePreferences) {
            prefs[THEME] = settings.theme.name
            prefs[MODE] = settings.mode.name
            prefs[ALWAYS_DARK_TERMINAL] = settings.alwaysDarkTerminal
            prefs[STRIP_CHIPS] = settings.stripChips.joinToString(SEPARATOR) { it.name }
            prefs[NOTIF_NEEDS_INPUT] = settings.notifications.needsInput
            prefs[NOTIF_FINISHED] = settings.notifications.finished
            prefs[NOTIF_SUBAGENTS] = settings.notifications.subagents
            prefs[TERMINAL_FONT_SP] = settings.terminalFontSp
            prefs[KEY_BAR] = settings.keyBar
            prefs[SWIPE_TABS] = settings.swipeTabs
            prefs[WORD_SUGGESTIONS] = settings.wordSuggestions
            prefs[MUTED_SESSIONS] = settings.mutedSessions
        }

        /** The chips [saved] names, in its order; an empty string is no chips at all. */
        fun chips(saved: String): List<StripChip> =
            saved.split(SEPARATOR).mapNotNull { enumNamed<StripChip>(it) }.distinct()

        inline fun <reified E : Enum<E>> enumNamed(name: String?): E? =
            enumEntries<E>().firstOrNull { it.name == name }

        inline fun <reified E : Enum<E>> enumNamed(name: String?, default: E): E =
            enumNamed<E>(name) ?: default
    }
}
