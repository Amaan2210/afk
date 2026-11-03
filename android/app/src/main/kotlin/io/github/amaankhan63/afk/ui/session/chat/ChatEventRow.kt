package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind
import io.github.amaankhan63.afk.ui.session.chat.markdown.Markdown
import io.github.amaankhan63.afk.ui.session.chat.markdown.MarkdownText
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

/** The widest a user's message gets, as a share of the row. */
private const val BUBBLE_WIDTH = 0.85f

/** A user's message: rounded but for the corner under its sender, at the bottom right. */
private val BUBBLE_SHAPE = RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp)

/** The `turn` phase that draws a divider; a turn's end draws nothing. */
internal const val TURN_START = "start"

/**
 * One event of a thread, drawn by its kind. A tool's card is [toolExpanded] and toggles through
 * [onToggleTool]; the other callbacks are [ChatTab]'s. An event without the part its kind needs
 * shows its text, as an assistant's message would.
 */
@Composable
fun ChatEventRow(
    event: ChatEvent,
    toolExpanded: Boolean,
    onToggleTool: () -> Unit,
    onOpenThread: (String) -> Unit,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Boolean,
    onFocusComposer: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val tool = event.tool
    val subagent = event.subagent
    val pending = event.pending
    val kind = event.kind
    when {
        kind == ChatKind.user -> UserBubble(event.text.orEmpty(), modifier)

        kind == ChatKind.tool && tool != null ->
            ToolCard(tool, toolExpanded, onToggleTool, modifier)

        kind == ChatKind.subagent && subagent != null ->
            SubagentCard(subagent, onClick = { onOpenThread(subagent.threadId) }, modifier)

        (kind == ChatKind.question || kind == ChatKind.permission) && pending != null ->
            PendingCard(pending, onAnswer, onFocusComposer, modifier)

        kind == ChatKind.turn -> if (event.turn?.phase == TURN_START) {
            val line = MaterialTheme.colorScheme.outline
            HorizontalDivider(modifier.padding(vertical = 4.dp), color = line)
        }

        else -> AssistantText(event, modifier)
    }
}

@Composable
private fun UserBubble(text: String, modifier: Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        // At most the share of the row, and as narrow as its text within it.
        Box(Modifier.fillMaxWidth(BUBBLE_WIDTH).wrapContentWidth(Alignment.End)) {
            // A long press selects the message's text, to copy it.
            SelectionContainer {
                Text(
                    text = text,
                    modifier = Modifier
                        .background(LocalAfkPalette.current.accentSoft, BUBBLE_SHAPE)
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}

/** The event's text as markdown, parsed once per text; a long press selects it, to copy it. */
@Composable
private fun AssistantText(event: ChatEvent, modifier: Modifier) {
    val blocks = remember(event.id, event.text) { Markdown.parse(event.text.orEmpty()) }
    SelectionContainer(modifier.fillMaxWidth()) {
        MarkdownText(blocks, Modifier.fillMaxWidth())
    }
}
