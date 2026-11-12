package io.github.amaankhan63.afk.ui.newsession

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map

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
    var name by rememberSaveable { mutableStateOf(viewModel.ui.value.name) }
    var model by rememberSaveable { mutableStateOf(viewModel.ui.value.model) }
    var prompt by rememberSaveable { mutableStateOf(viewModel.ui.value.prompt) }
    var picking by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    // After process death the fields get their text back but the view model starts empty.
    LaunchedEffect(viewModel) {
        viewModel.setName(name)
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
    val open by rememberUpdatedState(onCreated)
    LaunchedEffect(viewModel) { viewModel.created.collect { open(it) } }
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
                state = state.copy(name = name, model = model, prompt = prompt),
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
                modifier = Modifier.weight(1f),
                onName = {
                    name = it
                    viewModel.setName(it)
                }
            )
            Button(
                onClick = viewModel::start,
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
