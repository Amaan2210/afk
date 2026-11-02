package io.github.amaankhan63.afk.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.ui.theme.AfkPalette
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

private val TAG_SHAPE = RoundedCornerShape(6.dp)
private const val AGENT_FILL_ALPHA = 0.12f
private const val AGENT_BORDER_ALPHA = 0.35f

/** The colour that marks a session of [kind]. */
fun AfkPalette.agentColor(kind: SessionKind): Color = when (kind) {
    SessionKind.claude -> claude
    SessionKind.codex -> codex
    SessionKind.shell -> shell
}

/** The agent's name with its mark, as tags and filter chips show it. */
fun agentLabel(kind: SessionKind): String = when (kind) {
    SessionKind.claude -> "✱ Claude"
    SessionKind.codex -> "◈ Codex"
    SessionKind.shell -> ">_ Shell"
}

/** The agent of a session, in the agent's colour. */
@Composable
fun AgentTag(kind: SessionKind, modifier: Modifier = Modifier) {
    val color = LocalAfkPalette.current.agentColor(kind)
    Tag(
        text = agentLabel(kind),
        modifier = modifier,
        color = color,
        container = color.copy(alpha = AGENT_FILL_ALPHA),
        border = color.copy(alpha = AGENT_BORDER_ALPHA),
        bold = true
    )
}

/** A small one-line label, such as a session's branch. */
@Composable
fun Tag(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    container: Color = MaterialTheme.colorScheme.surfaceContainerHighest,
    border: Color = MaterialTheme.colorScheme.outline,
    bold: Boolean = false
) {
    Text(
        text = text,
        modifier = modifier
            .background(container, TAG_SHAPE)
            .border(1.dp, border, TAG_SHAPE)
            .padding(horizontal = 7.dp, vertical = 2.dp),
        color = color,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = if (bold) FontWeight.Bold else null,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}
