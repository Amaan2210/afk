package io.github.amaankhan63.afk.ui.session.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.ui.session.KeyBar
import io.github.amaankhan63.afk.ui.session.KeyBarState
import io.github.amaankhan63.afk.ui.theme.TerminalColors

private val TERMINAL_SHAPE = RoundedCornerShape(10.dp)

/**
 * The Terminal tab: [bridge]'s terminal and, when [keyBar] is on, the key bar under it, whose keys
 * go to [onBytes] and whose keyboard key calls [onToggleKeyboard]. A [failure] to show the
 * terminal is reported over it, with a Retry that calls [onRetry].
 */
@Composable
fun TerminalTab(
    bridge: TerminalBridge,
    colors: TerminalColors,
    fontSizeSp: Int,
    onFontSizeChange: (Int) -> Unit,
    keyBar: Boolean,
    keyBarState: KeyBarState,
    onBytes: (ByteArray) -> Unit,
    onToggleKeyboard: () -> Unit,
    failure: AfkError?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier.fillMaxSize()) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 10.dp)
                .clip(TERMINAL_SHAPE)
                .background(colors.background)
        ) {
            // The view stays while the failure shows, keeping the last screen the terminal had.
            TerminalHost(
                bridge = bridge,
                colors = colors,
                fontSizeSp = fontSizeSp,
                onFontSizeChange = onFontSizeChange,
                modifier = Modifier.fillMaxSize().padding(8.dp)
            )
            if (failure != null) {
                TerminalFailure(failure, onRetry, Modifier.align(Alignment.TopCenter))
            }
        }
        if (keyBar) KeyBar(keyBarState, onBytes, onToggleKeyboard)
    }
}

@Composable
private fun TerminalFailure(failure: AfkError, onRetry: () -> Unit, modifier: Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(8.dp),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "The terminal stopped: ${failure.message ?: failure.code}",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall
            )
            TextButton(onClick = onRetry) { Text("Retry") }
        }
    }
}
