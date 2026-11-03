package io.github.amaankhan63.afk.ui.settings

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.settings.AppSettings
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** The app's settings as the screens outside Settings read them, such as a session's terminal. */
@HiltViewModel
class AppSettingsViewModel @Inject constructor(private val store: AppSettingsStore) : ViewModel() {
    val settings: StateFlow<AppSettings> = store.settings

    /** Saves the terminal's font size, as a pinch changes it. */
    fun setFontSize(sp: Int) {
        viewModelScope.launch {
            try {
                store.update { it.copy(terminalFontSp = sp) }
            } catch (e: IOException) {
                // The size stays as it was; the next pinch tries again.
                Log.w(TAG, "font size not saved", e)
            }
        }
    }

    private companion object {
        const val TAG = "AppSettingsViewModel"
    }
}
