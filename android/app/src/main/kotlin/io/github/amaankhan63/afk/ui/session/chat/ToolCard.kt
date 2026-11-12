package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.ToolInfo
import io.github.amaankhan63.afk.data.protocol.ToolStatus
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

/** Characters of a tool's input or result shown before "Show more". */
private const val SHOWN_CHARS = 4_000

/** The widest a tool's name gets in its card's line, about 25 characters. */
private val NAME_MAX_WIDTH = 160.dp

/**
 * One tool call: its status, name and summary on one quiet line, without a border, so the
 * messages around it lead. Tapping it calls [onToggle]; while [expanded] it also shows the call's
 * input and result.
 */
@Composable
fun ToolCard(
    tool: ToolInfo,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        onClick = onToggle,
        modifier = modifier.fillMaxWidth().semantics {
            role = Role.Button
            stateDescription = if (expanded) "Expanded" else "Collapsed"
        },
        shape = MaterialTheme.shapes.small,
        color = if (expanded) colors.surfaceContainerLow else colors.surfaceContainerLowest
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 5.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val (glyph, color) = statusGlyph(tool.status)
                Text(glyph, color = color, style = MaterialTheme.typography.bodySmall)
                // One line, so a long tool name (an MCP server's) cannot wrap the card, and no
                // wider than NAME_MAX_WIDTH, so the summary keeps room. A weight would cap the
                // summary too: a Row gives a short name's unused share to no one.
                Text(
                    text = tool.name,
                    modifier = Modifier.widthIn(max = NAME_MAX_WIDTH),
                    fontWeight = FontWeight.SemiBold,
                    color = colors.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = tool.summary,
                    modifier = Modifier.weight(1f),
                    color = colors.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (expanded) {
                tool.input?.let { Detail("Input", it) }
                tool.result?.let { Detail("Result", it) }
            }
        }
    }
}

@Composable
private fun statusGlyph(status: ToolStatus): Pair<String, Color> {
    val palette = LocalAfkPalette.current
    return when (status) {
        ToolStatus.ok -> "✓" to palette.green
        ToolStatus.running -> "●" to palette.amber
        ToolStatus.error -> "✕" to MaterialTheme.colorScheme.error
    }
}

/** A tool's input or result under its [label], cut at [SHOWN_CHARS] until "Show more". */
@Composable
private fun Detail(label: String, text: String) {
    var all by rememberSaveable { mutableStateOf(false) }
    val cut = !all && text.length > SHOWN_CHARS
    Text(
        text = label,
        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelSmall
    )
    Text(
        text = if (cut) text.take(SHOWN_CHARS) + "…" else text,
        fontFamily = FontFamily.Monospace,
        style = MaterialTheme.typography.bodySmall
    )
    if (cut) TextButton(onClick = { all = true }) { Text("Show more") }
}
