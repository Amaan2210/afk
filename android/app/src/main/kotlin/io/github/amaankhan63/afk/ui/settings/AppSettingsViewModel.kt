package io.github.amaankhan63.afk.ui.settings

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.settings.AppSettings
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import io.github.amaankhan63.afk.data.settings.MAX_TERMINAL_FONT_SP
import io.github.amaankhan63.afk.data.settings.MIN_TERMINAL_FONT_SP
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** The app's settings as the screens outside Settings read them, such as a session's terminal. */
@HiltViewModel
class AppSettingsViewModel @Inject constructor(private val store: AppSettingsStore) : ViewModel() {
    val settings: StateFlow<AppSettings> = store.settings

    /** Saves the terminal's font size, as a pinch changes it, within the sizes Settings allows. */
    fun setFontSize(sp: Int) {
        val size = sp.coerceIn(MIN_TERMINAL_FONT_SP, MAX_TERMINAL_FONT_SP)
        viewModelScope.launch {
            try {
                store.update { it.copy(terminalFontSp = size) }
            } catch (e: IOException) {
                // The size stays as it was; the next pinch tries again.
                Log.w(TAG, "font size not saved", e)
            }
        }
    }

    /** Turns session [sessionId]'s notifications off ([muted]) or back on, on this phone. */
    fun setMuted(sessionId: String, muted: Boolean) {
        viewModelScope.launch {
            try {
                store.update {
                    val ids = it.mutedSessions
                    it.copy(mutedSessions = if (muted) ids + sessionId else ids - sessionId)
                }
            } catch (e: IOException) {
                // It stays as it was; the next tap tries again.
                Log.w(TAG, "mute not saved", e)
            }
        }
    }

    private companion object {
        const val TAG = "AppSettingsViewModel"
    }
}
