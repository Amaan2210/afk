package io.github.amaankhan63.afk.ui.settings.sections

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.ui.components.Dot
import io.github.amaankhan63.afk.ui.settings.SettingsUiState
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

/**
 * The paired laptop: its name and address, whether it stays awake while agents work, and Unpair.
 * The switch waits for the daemon's settings, and for its answer to a change.
 */
@Composable
internal fun LaptopSection(
    state: SettingsUiState,
    onKeepAwake: (Boolean) -> Unit,
    onUnpair: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    val palette = LocalAfkPalette.current
    SettingsGroup("Laptop") {
        SettingRow(
            title = state.hostname ?: "Not connected",
            note = state.address?.let { if (state.connected) "Connected · $it" else it }
        ) {
            Dot(if (state.connected) palette.green else colors.outline)
        }
        RowDivider()
        SwitchRow(
            title = "Keep laptop awake while agents work",
            note = "Releases ${state.graceMin} min after the last agent goes idle",
            checked = state.keepAwake == true,
            enabled = state.keepAwake != null && !state.keepAwakeBusy,
            onChange = onKeepAwake
        )
        RowDivider()
        TextButton(
            onClick = onUnpair,
            modifier = Modifier.padding(horizontal = 4.dp),
            colors = ButtonDefaults.textButtonColors(contentColor = colors.error)
        ) {
            Text("Unpair")
        }
    }
}
