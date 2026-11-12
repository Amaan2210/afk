package io.github.amaankhan63.afk.ui.settings.sections

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.settings.MAX_TERMINAL_FONT_SP
import io.github.amaankhan63.afk.data.settings.MIN_TERMINAL_FONT_SP
import kotlin.math.roundToInt

/**
 * The terminal's font size, which a pinch on the terminal also changes, its key bar, and whether
 * a sideways swipe changes between a session's Terminal and Chat. A change of [fontSaveFailures]
 * says a size could not be saved: the slider goes back to the saved size.
 */
@Composable
internal fun TerminalSection(
    fontSizeSp: Int,
    keyBar: Boolean,
    fontSaveFailures: Int,
    onFontSize: (Int) -> Unit,
    onKeyBar: (Boolean) -> Unit,
    swipeTabs: Boolean = false,
    onSwipeTabs: (Boolean) -> Unit = {}
) {
    // The size under the thumb while dragging and until it is saved; only the end is saved.
    var dragged by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(fontSizeSp, fontSaveFailures) { dragged = null }
    val shown = dragged ?: fontSizeSp.toFloat()
    SettingsGroup("Terminal") {
        SettingRow(title = "Font size") {
            Text(
                "${shown.roundToInt()} sp",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Slider(
            value = shown,
            onValueChange = { dragged = it },
            onValueChangeFinished = { dragged?.let { onFontSize(it.roundToInt()) } },
            modifier = Modifier.padding(horizontal = 12.dp),
            valueRange = MIN_TERMINAL_FONT_SP.toFloat()..MAX_TERMINAL_FONT_SP.toFloat(),
            // One stop per size between the ends.
            steps = MAX_TERMINAL_FONT_SP - MIN_TERMINAL_FONT_SP - 1
        )
        RowDivider()
        SwitchRow(
            title = "Key bar",
            note = "Extra keys under the terminal",
            checked = keyBar,
            onChange = onKeyBar
        )
        RowDivider()
        SwitchRow(
            title = "Swipe between Terminal and Chat",
            note = "Off, only the tabs at the top change between them",
            checked = swipeTabs,
            onChange = onSwipeTabs
        )
    }
}
