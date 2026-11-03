package io.github.amaankhan63.afk.ui.newsession

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * The laptop's folders, in a bottom sheet: a path field, the folders sessions started in lately
 * ([NewSessionUiState.recent]), then the folders of the listing [state] holds, which starts at the
 * drives. A tap on a listed folder opens it ([onBrowse]); its Use action, a tap on a recent
 * folder, or the submitted path chooses one ([onPick]). Failures show in [snackbarHostState] here,
 * since the screen's own host is under the sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderPicker(
    state: NewSessionUiState,
    onBrowse: (String?) -> Unit,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
    snackbarHostState: SnackbarHostState
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // The sheet slides away before the folder is chosen.
    val pick: (String) -> Unit = { path ->
        scope.launch { sheet.hide() }.invokeOnCompletion { onPick(path) }
    }
    val listing = state.browse
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Box {
            Column {
                PathField(listed = listing?.path, onSubmit = pick)
                // Each listing starts at its top.
                key(listing?.path) {
                    LazyColumn(Modifier.fillMaxWidth()) {
                        if (state.recent.isNotEmpty()) {
                            item { Heading("Recent") }
                            items(state.recent) { path ->
                                FolderRow(path, mono = true) { pick(path) }
                            }
                        }
                        item { Heading(listing?.path ?: "Drives", mono = listing?.path != null) }
                        // A drive's root has no parent: Up from it lists the drives.
                        if (listing?.path != null) {
                            item {
                                FolderRow("Up", icon = Icons.Default.KeyboardArrowUp) {
                                    onBrowse(listing.parent)
                                }
                            }
                        }
                        items(listing?.dirs.orEmpty()) { dir ->
                            FolderRow(dir.name, onUse = { pick(dir.path) }) { onBrowse(dir.path) }
                        }
                    }
                }
            }
            SnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter))
        }
    }
}

/**
 * A folder's path to type. It follows the listing, so submitted as it is it chooses the folder
 * listed.
 */
@Composable
private fun PathField(listed: String?, onSubmit: (String) -> Unit) {
    var text by rememberSaveable(listed) { mutableStateOf(listed.orEmpty()) }
    val submit = { if (text.isNotBlank()) onSubmit(text) }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
        placeholder = { Text("D:\\Repos\\app", fontFamily = FontFamily.Monospace) },
        trailingIcon = {
            IconButton(onClick = submit, enabled = text.isNotBlank()) {
                Icon(Icons.Default.Check, contentDescription = "Use this folder")
            }
        },
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { submit() }),
        singleLine = true
    )
}

@Composable
private fun Heading(text: String, mono: Boolean = false) {
    Text(
        text = text,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelMedium,
        fontFamily = if (mono) FontFamily.Monospace else null
    )
}

@Composable
private fun FolderRow(
    text: String,
    mono: Boolean = false,
    icon: ImageVector? = null,
    onUse: (() -> Unit)? = null,
    onClick: () -> Unit
) {
    ListItem(
        headlineContent = {
            Text(
                text = text,
                fontFamily = if (mono) FontFamily.Monospace else null,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        },
        modifier = Modifier.clickable(onClick = onClick),
        leadingContent = icon?.let { { Icon(it, contentDescription = null) } },
        trailingContent = onUse?.let { { TextButton(onClick = it) { Text("Use") } } },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent)
    )
}
