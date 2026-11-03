package io.github.amaankhan63.afk.ui.settings.sections

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.settings.AppSettings
import io.github.amaankhan63.afk.ui.theme.AfkThemeId
import io.github.amaankhan63.afk.ui.theme.Palettes
import io.github.amaankhan63.afk.ui.theme.ThemeMode

private val THEMES =
    listOf(AfkThemeId.Graphite, AfkThemeId.Ember, AfkThemeId.Aurora, AfkThemeId.Phosphor)

/**
 * The theme, offered with Dynamic from Android 12, where the system has wallpaper colours; light,
 * dark or the system's mode; and whether the terminal stays dark in light mode.
 */
@Composable
internal fun AppearanceSection(
    settings: AppSettings,
    onTheme: (AfkThemeId) -> Unit,
    onMode: (ThemeMode) -> Unit,
    onAlwaysDark: (Boolean) -> Unit
) {
    val sdk = Build.VERSION.SDK_INT
    val themes = if (sdk >= Build.VERSION_CODES.S) THEMES + AfkThemeId.Dynamic else THEMES
    // The theme shown, which is Graphite for a Dynamic this Android cannot show.
    val shown = Palettes.resolvesDynamic(settings.theme, sdk)
    SettingsGroup("Appearance") {
        SettingRow(title = "Theme")
        FlowRow(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            themes.forEach { id ->
                CheckChip(label = id.name, selected = id == shown, onClick = { onTheme(id) })
            }
        }
        RowDivider()
        SettingRow(title = "Mode")
        SingleChoiceSegmentedButtonRow(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp)
        ) {
            ThemeMode.entries.forEach { mode ->
                SegmentedButton(
                    selected = mode == settings.mode,
                    onClick = { onMode(mode) },
                    shape = SegmentedButtonDefaults.itemShape(mode.ordinal, ThemeMode.entries.size),
                    icon = {}
                ) { Text(mode.name, maxLines = 1) }
            }
        }
        RowDivider()
        SwitchRow(
            title = "Always dark terminal",
            note = "Keep the terminal dark even in light mode",
            checked = settings.alwaysDarkTerminal,
            onChange = onAlwaysDark
        )
    }
}
