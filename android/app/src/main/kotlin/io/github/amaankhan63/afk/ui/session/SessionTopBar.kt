package io.github.amaankhan63.afk.ui.session

import android.content.ClipData
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.ui.components.KillDialog
import io.github.amaankhan63.afk.ui.components.RenameDialog
import io.github.amaankhan63.afk.ui.components.StateDot
import io.github.amaankhan63.afk.ui.sessions.canResume
import io.github.amaankhan63.afk.ui.sessions.stateLabel
import java.time.Instant
import kotlinx.coroutines.launch

private const val CLIP_LABEL = "AFK attach command"

private enum class Dialog { Rename, Kill }

/**
 * The session screen's app bar: back, the session's name, and its agent and state under it. The
 * overflow menu offers Rename, Kill while the session has not ended, Resume for an ended agent
 * session that can be picked up again, and Copy attach command, which puts [attachCommand] on the
 * clipboard and then calls [onCopied]. Renaming and killing go through a dialog first.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionTopBar(
    session: Session?,
    onBack: () -> Unit,
    onRename: (name: String) -> Unit,
    onKill: () -> Unit,
    onResume: () -> Unit,
    onCopied: () -> Unit
) {
    var dialog by rememberSaveable { mutableStateOf<Dialog?>(null) }
    TopAppBar(
        title = { if (session != null) Title(session) },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
        },
        actions = {
            if (session != null) {
                Overflow(
                    session = session,
                    onRename = { dialog = Dialog.Rename },
                    onKill = { dialog = Dialog.Kill },
                    onResume = onResume,
                    onCopied = onCopied
                )
            }
        }
    )
    if (session == null) return
    val close = { dialog = null }
    when (dialog) {
        Dialog.Rename -> RenameDialog(session.name, onDismiss = close) {
            onRename(it)
            close()
        }

        Dialog.Kill -> KillDialog(session.name, onDismiss = close) {
            onKill()
            close()
        }

        null -> Unit
    }
}

@Composable
private fun Title(session: Session) {
    Column {
        Text(
            text = session.name,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(3.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            StateDot(session.state)
            Text(
                text = sessionSubtitle(session),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun Overflow(
    session: Session,
    onRename: () -> Unit,
    onKill: () -> Unit,
    onResume: () -> Unit,
    onCopied: () -> Unit
) {
    var open by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val choose = { action: () -> Unit ->
        open = false
        action()
    }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = "Session actions")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Rename") }, onClick = { choose(onRename) })
            // The daemon ignores a kill of an ended session: there is nothing left to stop.
            if (session.state != SessionState.ended) {
                DropdownMenuItem(
                    text = { Text("Kill", color = MaterialTheme.colorScheme.error) },
                    onClick = { choose(onKill) }
                )
            }
            if (session.canResume()) {
                DropdownMenuItem(text = { Text("Resume") }, onClick = { choose(onResume) })
            }
            DropdownMenuItem(
                text = { Text("Copy attach command") },
                onClick = {
                    choose {
                        val clip = ClipData.newPlainText(CLIP_LABEL, attachCommand(session))
                        scope.launch {
                            clipboard.setClipEntry(ClipEntry(clip))
                            onCopied()
                        }
                    }
                }
            )
        }
    }
}

/** What opens [session]'s terminal in a window on the laptop. */
internal fun attachCommand(session: Session) = "afk attach ${session.name}"

/** The session's agent and state, `Claude · Needs your input`, the state as its card says it. */
internal fun sessionSubtitle(session: Session): String =
    "${agentName(session.kind)} · ${stateLabel(session, workingSince = null, now = Instant.now())}"

internal fun agentName(kind: SessionKind): String = when (kind) {
    SessionKind.claude -> "Claude"
    SessionKind.codex -> "Codex"
    SessionKind.shell -> "Shell"
}
