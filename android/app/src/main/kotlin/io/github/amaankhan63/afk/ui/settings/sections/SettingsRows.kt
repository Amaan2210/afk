package io.github.amaankhan63.afk.ui.settings.sections

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em

/** A section of Settings: a card with [title] over its rows. */
@Composable
internal fun SettingsGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    val colors = MaterialTheme.colorScheme
    val shape = MaterialTheme.shapes.large
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surfaceContainerLow, shape)
            .border(1.dp, colors.outline, shape)
            .clip(shape)
    ) {
        Text(
            text = title.uppercase(),
            modifier = Modifier
                .padding(start = 12.dp, end = 12.dp, top = 9.dp, bottom = 4.dp)
                .semantics { heading() },
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.08.em,
            color = colors.onSurfaceVariant
        )
        content()
    }
}

/** A row of a [SettingsGroup]: [title], an optional [note] under it, and [trailing] at its end. */
@Composable
internal fun SettingRow(
    title: String,
    modifier: Modifier = Modifier,
    note: String? = null,
    trailing: @Composable () -> Unit = {}
) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Column(Modifier.weight(1f)) {
            val type = MaterialTheme.typography
            Text(title, style = type.bodyMedium, color = colors.onSurface)
            if (note != null) Text(note, style = type.bodySmall, color = colors.onSurfaceVariant)
        }
        trailing()
    }
}

/** A [SettingRow] whose switch, and the whole row, turn [title] on and off. */
@Composable
internal fun SwitchRow(
    title: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    note: String? = null,
    enabled: Boolean = true
) {
    SettingRow(
        title = title,
        modifier = Modifier.toggleable(
            value = checked,
            enabled = enabled,
            role = Role.Switch,
            onValueChange = onChange
        ),
        note = note
    ) {
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

/** A [FilterChip] that shows a check while [selected]. */
@Composable
internal fun CheckChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        leadingIcon = if (selected) {
            { Icon(Icons.Default.Check, null, Modifier.size(FilterChipDefaults.IconSize)) }
        } else {
            null
        }
    )
}

/** The line between two rows of a [SettingsGroup]. */
@Composable
internal fun RowDivider() = HorizontalDivider()
