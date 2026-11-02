package io.github.amaankhan63.afk.ui.sessions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import kotlinx.coroutines.launch

private enum class Step { Menu, Rename, Kill }

/**
 * What a long press on [session] offers: a sheet with Rename, Kill and, for an ended agent session
 * that can be picked up again, Resume. Renaming and killing go through a dialog first.
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
private fun Session.canResume() = state == SessionState.ended && agentSessionId != null

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
        Action("Kill", color = MaterialTheme.colorScheme.error) { afterHiding(onKill) }
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

/** Asks for a new name, starting from [current], all of it selected. */
@Composable
private fun RenameDialog(current: String, onDismiss: () -> Unit, onRename: (String) -> Unit) {
    var name by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(current, TextRange(0, current.length)))
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(focus) { focus.requestFocus() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename session") },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                modifier = Modifier.focusRequester(focus),
                label = { Text("Name") },
                singleLine = true
            )
        },
        // The daemon refuses a blank name.
        confirmButton = {
            TextButton(onClick = { onRename(name.text.trim()) }, enabled = name.text.isNotBlank()) {
                Text("Rename")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
private fun KillDialog(name: String, onDismiss: () -> Unit, onKill: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Kill $name?") },
        text = { Text("Its terminal closes and whatever runs in it stops.") },
        confirmButton = {
            TextButton(onClick = onKill) { Text("Kill", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
