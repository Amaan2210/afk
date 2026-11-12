package io.github.amaankhan63.afk.ui.session.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.ui.session.KeyBar
import io.github.amaankhan63.afk.ui.session.KeyBarState
import io.github.amaankhan63.afk.ui.session.chat.PendingCard
import io.github.amaankhan63.afk.ui.theme.TerminalColors

private val TERMINAL_SHAPE = RoundedCornerShape(10.dp)

/** The tallest a waiting prompt's card gets under the terminal; it scrolls beyond that. */
private val PROMPT_MAX_HEIGHT = 220.dp

/**
 * The Terminal tab: [bridge]'s terminal and, when [keyBar] is on, the key bar under it, whose keys
 * go to [onBytes] and whose keyboard key calls [onToggleKeyboard]. Its armed Ctrl also applies to
 * the next character typed into the terminal. A [failure] to show the terminal is reported over
 * it, with a Retry that calls [onRetry].
 *
 * Typing goes straight into the terminal: a tap on it opens the keyboard. A [prompt] the agent
 * waits on shows as a card under the terminal, and a tap on one of its options answers it through
 * [onAnswer], which says whether the answer went out.
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
    modifier: Modifier = Modifier,
    prompt: Pending? = null,
    onAnswer: (
        pendingId: String,
        choices: List<Int>?,
        text: String?,
        decision: String?
    ) -> Boolean = { _, _, _, _ -> false }
) {
    Column(modifier.fillMaxSize().padding(bottom = 8.dp)) {
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
                modifier = Modifier.fillMaxSize().padding(8.dp),
                keyBarState = keyBarState.takeIf { keyBar }
            )
            if (failure != null) {
                TerminalFailure(failure, onRetry, Modifier.align(Alignment.TopCenter))
            }
        }
        if (prompt != null) {
            // Its own state per prompt: the next one starts with its options on.
            key(prompt) {
                Box(
                    Modifier
                        .padding(start = 10.dp, end = 10.dp, top = 6.dp)
                        .heightIn(max = PROMPT_MAX_HEIGHT)
                        .verticalScroll(rememberScrollState())
                ) {
                    PendingCard(prompt, onAnswer, onFocusComposer = null)
                }
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
