package io.github.amaankhan63.afk.ui.sessions

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.ui.components.AgentTag
import io.github.amaankhan63.afk.ui.components.StateDot
import io.github.amaankhan63.afk.ui.components.Tag
import io.github.amaankhan63.afk.ui.components.agentColor
import io.github.amaankhan63.afk.ui.components.stateColor
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette
import io.github.amaankhan63.afk.ui.util.relativeTime
import java.time.Instant

private val AGENT_EDGE = 3.dp

/**
 * One session in the list: its state, name, age and last message, its agent's colour on the
 * left edge. [workingSince] is when the session was first seen working, if it is.
 */
@Composable
fun SessionCard(
    session: Session,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    workingSince: Instant? = null,
    now: Instant = Instant.now()
) {
    val shape = MaterialTheme.shapes.large
    val colors = MaterialTheme.colorScheme
    val agent = LocalAfkPalette.current.agentColor(session.kind)
    Surface(
        modifier = modifier
            .testTag("session-${session.id}")
            .clip(shape)
            .combinedClickable(
                role = Role.Button,
                onLongClickLabel = "Session actions",
                onLongClick = onLongClick,
                onClick = onClick
            )
            // Over the card's border, so the agent's colour replaces it on the left edge.
            .drawWithContent {
                drawContent()
                drawRect(agent, size = Size(AGENT_EDGE.toPx(), size.height))
            },
        shape = shape,
        color = colors.surfaceContainerLow,
        border = BorderStroke(1.dp, colors.outline)
    ) {
        Column(
            Modifier.padding(start = AGENT_EDGE + 12.dp, end = 12.dp, top = 11.dp, bottom = 10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // The label under the name says the state; screen readers need not hear it twice.
                StateDot(session.state, describe = false)
                Text(
                    text = session.name,
                    modifier = Modifier.weight(1f).padding(horizontal = 6.dp),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = relativeTime(session.lastActivityAt, now),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceVariant
                )
            }
            Text(
                text = stateLabel(session, workingSince, now),
                modifier = Modifier.padding(top = 5.dp),
                style = MaterialTheme.typography.bodySmall,
                color = labelColor(session.state)
            )
            session.lastMessage?.let { message ->
                Text(
                    text = message,
                    modifier = Modifier.padding(top = 4.dp),
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = colors.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                AgentTag(session.kind)
                if (session.subagentsRunning > 0) Tag(subagentsLabel(session.subagentsRunning))
                session.gitBranch?.let { Tag(it, Modifier.weight(1f, fill = false)) }
            }
        }
    }
}

/** What the card says of [session]'s state; a working session counts from [workingSince]. */
internal fun stateLabel(session: Session, workingSince: Instant?, now: Instant): String =
    when (session.state) {
        SessionState.needs_input -> "Needs your input"

        SessionState.finished ->
            if (session.lastMessage?.trimEnd()?.endsWith('?') == true) {
                "Finished · asked you something"
            } else {
                "Finished"
            }

        SessionState.working ->
            workingSince?.let { "Working · ${relativeTime(it, now)}" } ?: "Working"

        // An idle session is at its shell prompt, also after an agent in it exited.
        SessionState.idle -> "Shell · idle"

        SessionState.ended -> "Ended"
    }

private fun subagentsLabel(count: Int) = if (count == 1) "1 sub-agent" else "$count sub-agents"

/** The state's colour where it reads on the card; the quiet states use secondary text. */
@Composable
private fun labelColor(state: SessionState): Color = when (state) {
    SessionState.idle, SessionState.ended -> MaterialTheme.colorScheme.onSurfaceVariant
    else -> LocalAfkPalette.current.stateColor(state)
}
