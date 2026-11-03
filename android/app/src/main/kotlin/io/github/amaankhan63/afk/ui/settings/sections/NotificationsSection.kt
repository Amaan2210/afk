package io.github.amaankhan63.afk.ui.settings.sections

import androidx.compose.runtime.Composable
import io.github.amaankhan63.afk.data.settings.NotificationPrefs

/** One switch per kind of session notification; [onChange] applies a change to the saved ones. */
@Composable
internal fun NotificationsSection(
    prefs: NotificationPrefs,
    onChange: ((NotificationPrefs) -> NotificationPrefs) -> Unit
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
    }
}
