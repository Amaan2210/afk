package io.github.amaankhan63.afk.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.amaankhan63.afk.data.sessions.SessionFilter
import java.time.Instant
import kotlinx.coroutines.delay

/** How often card ages and working durations are brought up to date. */
private const val CLOCK_TICK_MS = 30_000L

/** Room under the last card so the button does not cover it. */
private val FAB_CLEARANCE = 88.dp

/** The home screen: every session on the laptop, searchable and filterable. */
@Composable
fun SessionsScreen(onOpen: (String) -> Unit, onNew: () -> Unit, onSettings: () -> Unit) {
    val viewModel: SessionsViewModel = hiltViewModel()
    val state by viewModel.ui.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val open by rememberUpdatedState(onOpen)
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(CLOCK_TICK_MS)
            now = Instant.now()
        }
    }
    LaunchedEffect(viewModel) {
        viewModel.errors.collect { snackbar.showSnackbar(it.message ?: it.code) }
    }
    LaunchedEffect(viewModel) { viewModel.resumed.collect { open(it) } }
    SessionsScreen(
        state = state,
        onOpen = onOpen,
        onNew = onNew,
        onSettings = onSettings,
        onQuery = viewModel::onQuery,
        onFilter = viewModel::onFilter,
        onRename = viewModel::rename,
        onKill = viewModel::kill,
        onResume = viewModel::resume,
        snackbarHostState = snackbar,
        now = now
    )
}

/** The home screen as [state] describes it; a long press on a card opens its actions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(
    state: SessionsUiState,
    onOpen: (String) -> Unit,
    onNew: () -> Unit,
    onSettings: () -> Unit,
    onQuery: (String) -> Unit,
    onFilter: (SessionFilter) -> Unit,
    onRename: (id: String, name: String) -> Unit = { _, _ -> },
    onKill: (id: String) -> Unit = {},
    onResume: (id: String) -> Unit = {},
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
    now: Instant = Instant.now()
) {
    var actionsFor by rememberSaveable { mutableStateOf<String?>(null) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sessions", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = onSettings) {
                        // U+FE0E asks for the gear's text form rather than an emoji.
                        Text(
                            "\u2699\uFE0E",
                            Modifier.clearAndSetSemantics {
                                contentDescription = "Settings"
                            }
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            // The content overload: the icon-and-text one animates its text in and out.
            ExtendedFloatingActionButton(
                onClick = onNew,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            ) {
                Text("＋", Modifier.clearAndSetSemantics {})
                Spacer(Modifier.width(12.dp))
                Text("New session", fontWeight = FontWeight.Bold)
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            LaptopStrip(
                hostname = state.hostname,
                stats = state.stats,
                connection = state.connection,
                modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 8.dp)
            )
            OutlinedTextField(
                value = state.query,
                onValueChange = onQuery,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp),
                placeholder = { Text("Search sessions, projects, branches") },
                singleLine = true,
                shape = MaterialTheme.shapes.medium
            )
            FilterChipsRow(
                filter = state.filter,
                counts = state.counts,
                onFilter = onFilter,
                modifier = Modifier.padding(vertical = 8.dp)
            )
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth().testTag("session-list"),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = FAB_CLEARANCE),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(state.sessions, key = { it.id }) { session ->
                    SessionCard(
                        session = session,
                        onClick = { onOpen(session.id) },
                        onLongClick = { actionsFor = session.id },
                        workingSince = state.workingSince[session.id],
                        now = now
                    )
                }
            }
        }
    }

    // Looked up on every change, so the actions see the session's current name and state.
    val target = state.sessions.find { it.id == actionsFor }
    if (target != null) {
        SessionActionsSheet(
            session = target,
            onDismiss = { actionsFor = null },
            onRename = { onRename(target.id, it) },
            onKill = { onKill(target.id) },
            onResume = { onResume(target.id) }
        )
    }
    // A session that leaves the list, removed or filtered out, takes its actions with it for good.
    LaunchedEffect(target == null) {
        if (target == null) actionsFor = null
    }
}
