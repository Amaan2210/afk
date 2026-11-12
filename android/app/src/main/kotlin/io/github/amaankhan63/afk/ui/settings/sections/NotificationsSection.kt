package io.github.amaankhan63.afk.ui.settings.sections

import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import io.github.amaankhan63.afk.data.settings.NotificationPrefs

/**
 * One switch per kind of session notification; [onChange] applies a change to the saved ones.
 * [onSound] opens Android's own settings for the app, where each kind's sound is chosen.
 */
@Composable
internal fun NotificationsSection(
    prefs: NotificationPrefs,
    onChange: ((NotificationPrefs) -> NotificationPrefs) -> Unit,
    onSound: () -> Unit = {}
) {
    SettingsGroup("Notifications") {
        SwitchRow(
            title = "Needs your input",
            checked = prefs.needsInput,
            onChange = { on -> onChange { it.copy(needsInput = on) } }
        )
        RowDivider()
        SwitchRow(
            title = "Finished",
            checked = prefs.finished,
            onChange = { on -> onChange { it.copy(finished = on) } }
        )
        RowDivider()
        SwitchRow(
            title = "Sub-agent finished",
            checked = prefs.subagents,
            onChange = { on -> onChange { it.copy(subagents = on) } }
        )
        RowDivider()
        SettingRow(
            title = "Sound and vibration",
            modifier = Modifier.clickable(role = Role.Button, onClick = onSound),
            note = "Choose a sound for each kind in Android's settings"
        )
    }
}
