package io.github.amaankhan63.afk.ui.settings.sections

import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role

/** The app's [version], and its open-source licenses behind [onLicenses]. */
@Composable
internal fun AboutSection(version: String, onLicenses: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    SettingsGroup("About") {
        SettingRow(title = "Version") {
            Text(
                version,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant
            )
        }
        RowDivider()
        SettingRow(
            title = "About and licenses",
            modifier = Modifier.clickable(role = Role.Button, onClick = onLicenses)
        ) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.onSurfaceVariant
            )
        }
    }
}
