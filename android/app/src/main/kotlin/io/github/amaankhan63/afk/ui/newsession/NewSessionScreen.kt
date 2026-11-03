package io.github.amaankhan63.afk.ui.newsession

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.ui.components.agentLabel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map

private val AGENTS = listOf(SessionKind.claude, SessionKind.codex, SessionKind.shell)
private val CHECK_SIZE = FilterChipDefaults.IconSize

/**
 * Starts a session on the laptop: a folder chosen in [FolderPicker], an agent, its flags and an
 * optional first prompt. [onCreated] gets the new session's id; [onClose] leaves without one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSessionScreen(onCreated: (String) -> Unit, onClose: () -> Unit) {
    val viewModel: NewSessionViewModel = hiltViewModel()
    val state by viewModel.ui.collectAsStateWithLifecycle()
    // The fields' text lives here, not in the round trip through the view model's flow: a
    // recomposition before that trip ends would put stale text back under the keyboard.
    var model by rememberSaveable { mutableStateOf(viewModel.ui.value.model) }
    var prompt by rememberSaveable { mutableStateOf(viewModel.ui.value.prompt) }
    var picking by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    // After process death the fields get their text back but the view model starts empty.
    LaunchedEffect(viewModel) {
        viewModel.setModel(model)
        viewModel.setPrompt(prompt)
    }
    // Cleared before it shows, so the same words failing again show again.
    LaunchedEffect(viewModel) {
        viewModel.ui.map { it.error }.filterNotNull().collect {
            viewModel.clearError()
            snackbar.showSnackbar(it)
        }
    }
    // The picker opens on the drives, also after a folder was picked.
    LaunchedEffect(picking) {
        if (picking && viewModel.ui.value.browse == null) viewModel.browse(null)
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("New session") },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }
            )
        },
        // While the picker is open, its own host shows failures.
        snackbarHost = { if (!picking) SnackbarHost(snackbar) }
    ) { padding ->
        Column(Modifier.padding(padding).consumeWindowInsets(padding).imePadding().fillMaxSize()) {
            NewSessionForm(
                state = state.copy(model = model, prompt = prompt),
                onChooseFolder = { picking = true },
                onKind = viewModel::setKind,
                onToggleFlag = viewModel::toggleFlag,
                onModel = {
                    model = it
                    viewModel.setModel(it)
                },
                onPrompt = {
                    prompt = it
                    viewModel.setPrompt(it)
                },
                modifier = Modifier.weight(1f)
            )
            Button(
                onClick = { viewModel.start(onCreated) },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                enabled = state.canStart
            ) {
                if (state.starting) {
                    val color = LocalContentColor.current
                    CircularProgressIndicator(Modifier.size(20.dp), color, strokeWidth = 2.dp)
                } else {
                    Text("Start session", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
    if (picking) {
        FolderPicker(
            state = state,
            onBrowse = viewModel::browse,
            onPick = {
                picking = false
                viewModel.pick(it)
            },
            onDismiss = { picking = false },
            snackbarHostState = snackbar
        )
    }
}

/** The form as [state] describes it. The model's field shows while a chip needs it. */
@Composable
private fun NewSessionForm(
    state: NewSessionUiState,
    onChooseFolder: () -> Unit,
    onKind: (SessionKind) -> Unit,
    onToggleFlag: (String) -> Unit,
    onModel: (String) -> Unit,
    onPrompt: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val chips = LaunchFlags.chipsFor(state.kind)
    Column(
        modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Label("Folder")
        FolderField(state.cwd, onChooseFolder)
        Label("Agent")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            AGENTS.forEachIndexed { index, kind ->
                SegmentedButton(
                    selected = kind == state.kind,
                    onClick = { onKind(kind) },
                    shape = SegmentedButtonDefaults.itemShape(index, AGENTS.size),
                    icon = {}
                ) { Text(agentLabel(kind), maxLines = 1) }
            }
        }
        if (chips.isNotEmpty()) {
            Label("Flags")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                chips.forEach { chip ->
                    val selected = chip.id in state.flags
                    FilterChip(
                        selected = selected,
                        onClick = { onToggleFlag(chip.id) },
                        label = { Text(chip.label, fontFamily = FontFamily.Monospace) },
                        leadingIcon = if (selected) {
                            { Icon(Icons.Default.Check, null, Modifier.size(CHECK_SIZE)) }
                        } else {
                            null
                        }
                    )
                }
            }
        }
        if (chips.any { it.needsValue && it.id in state.flags }) {
            OutlinedTextField(
                value = state.model,
                onValueChange = onModel,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Model") },
                // A model's id is not a word to correct.
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                singleLine = true
            )
        }
        if (state.kind != SessionKind.shell) {
            OutlinedTextField(
                value = state.prompt,
                onValueChange = onPrompt,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                label = { Text("First prompt · optional") },
                minLines = 3
            )
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(
        text = text,
        modifier = Modifier.padding(top = 12.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelMedium
    )
}

/** The chosen folder, or a prompt to choose one; a tap opens the picker. */
@Composable
private fun FolderField(cwd: String, onClick: () -> Unit) {
    val chosen = cwd.isNotBlank()
    val hint = MaterialTheme.colorScheme.onSurfaceVariant
    OutlinedCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().semantics { role = Role.Button }
    ) {
        Row(
            Modifier.padding(start = 16.dp, end = 12.dp, top = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (chosen) cwd else "Choose a folder…",
                modifier = Modifier.weight(1f),
                color = if (chosen) Color.Unspecified else hint,
                fontFamily = if (chosen) FontFamily.Monospace else null,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Icon(Icons.Default.ArrowDropDown, contentDescription = null)
        }
    }
}
