package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.SubagentInfo
import io.github.amaankhan63.afk.data.protocol.SubagentStatus
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

private val ACCENT_EDGE = 3.dp

/** A sub-agent the turn started: its name, task and progress. [onClick] opens its thread. */
@Composable
fun SubagentCard(info: SubagentInfo, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    val accent = LocalAfkPalette.current.codex
    val shape = MaterialTheme.shapes.small
    Surface(
        onClick = onClick,
        // Over the card's border, and inside its corners, so the accent replaces the left edge.
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .drawWithContent {
                drawContent()
                drawRect(accent, size = Size(ACCENT_EDGE.toPx(), size.height))
            }
            .semantics { role = Role.Button },
        shape = shape,
        color = colors.surfaceContainerLow,
        border = BorderStroke(1.dp, colors.outline)
    ) {
        Column(
            Modifier.padding(start = ACCENT_EDGE + 10.dp, end = 10.dp, top = 8.dp, bottom = 8.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = info.name,
                    modifier = Modifier.weight(1f),
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text("›", color = colors.onSurfaceVariant)
            }
            Text(
                text = info.task,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = subagentMeta(info),
                modifier = Modifier.padding(top = 3.dp),
                color = colors.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall
            )
        }
    }
}

/** The sub-agent's state and tool count, `Sub-agent · done · 5 tool uses`. */
internal fun subagentMeta(info: SubagentInfo): String = "Sub-agent · ${subagentProgress(info)}"

/** The sub-agent's state and tool count without the label, `done · 5 tool uses`. */
internal fun subagentProgress(info: SubagentInfo): String {
    val status = when (info.status) {
        SubagentStatus.running -> "running"
        SubagentStatus.done -> "done"
        SubagentStatus.error -> "error"
    }
    val uses = if (info.toolUses == 1) "1 tool use" else "${info.toolUses} tool uses"
    return "$status · $uses"
}
