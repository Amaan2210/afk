package io.github.amaankhan63.afk.ui.sessions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.ui.components.KillDialog
import io.github.amaankhan63.afk.ui.components.RenameDialog
import kotlinx.coroutines.launch

private enum class Step { Menu, Rename, Kill }

/**
 * What a long press on [session] offers: a sheet with Rename, Kill while the session has not
 * ended, and Resume for an ended agent session that can be picked up again. Renaming and killing
 * go through a dialog first.
 */
@Composable
internal fun SessionActionsSheet(
    session: Session,
    onDismiss: () -> Unit,
    onRename: (name: String) -> Unit,
    onKill: () -> Unit,
    onResume: () -> Unit
) {
    var step by rememberSaveable(session.id) { mutableStateOf(Step.Menu) }
    when (step) {
        Step.Menu -> ActionsMenu(
            session = session,
            onDismiss = onDismiss,
            onRename = { step = Step.Rename },
            onKill = { step = Step.Kill },
            onResume = {
                onResume()
                onDismiss()
            }
        )

        Step.Rename -> RenameDialog(
            current = session.name,
            onDismiss = onDismiss,
            onRename = {
                onRename(it)
                onDismiss()
            }
        )

        Step.Kill -> KillDialog(
            name = session.name,
            onDismiss = onDismiss,
            onKill = {
                onKill()
                onDismiss()
            }
        )
    }
}

/** The daemon resumes an ended session from its agent's own session id. */
internal fun Session.canResume() = state == SessionState.ended && agentSessionId != null

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActionsMenu(
    session: Session,
    onDismiss: () -> Unit,
    onRename: () -> Unit,
    onKill: () -> Unit,
    onResume: () -> Unit
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // The sheet slides away before the action's dialog shows or the action runs.
    val afterHiding = { action: () -> Unit ->
        scope.launch { sheet.hide() }.invokeOnCompletion { action() }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Text(
            text = session.name,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
            style = MaterialTheme.typography.titleMedium
        )
        Action("Rename") { afterHiding(onRename) }
        // The daemon ignores a kill of an ended session: there is nothing left to stop.
        if (session.state != SessionState.ended) {
            Action("Kill", color = MaterialTheme.colorScheme.error) { afterHiding(onKill) }
        }
        if (session.canResume()) Action("Resume") { afterHiding(onResume) }
    }
}

@Composable
private fun Action(label: String, color: Color = Color.Unspecified, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(label, color = color) },
        modifier = Modifier.clickable(onClick = onClick),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent)
    )
}
