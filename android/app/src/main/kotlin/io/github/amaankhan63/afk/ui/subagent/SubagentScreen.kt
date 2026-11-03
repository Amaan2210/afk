package io.github.amaankhan63.afk.ui.subagent

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.amaankhan63.afk.ui.session.chat.ChatTab
import io.github.amaankhan63.afk.ui.session.chat.ChatUnavailable

/**
 * A sub-agent's thread: its events as the Chat tab shows them, under a top bar with the sub-agent's
 * task and progress. The view model reads the ids from the route's `id` and `threadId`;
 * [sessionId] and [threadId] key it. A nested sub-agent's card opens its thread through
 * [onOpenThread].
 *
 * There is no composer: a question's typed answer is given from the session screen. While the
 * screen is resumed the session's notifications are held back, as on the session's screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubagentScreen(
    sessionId: String,
    threadId: String,
    onBack: () -> Unit,
    onOpenThread: (String) -> Unit
) {
    val viewModel: SubagentViewModel = hiltViewModel(key = "$sessionId/$threadId")
    val title by viewModel.title.collectAsStateWithLifecycle()
    val status by viewModel.status.collectAsStateWithLifecycle()
    val events by viewModel.chat.events.collectAsStateWithLifecycle()
    val chatError by viewModel.chat.error.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(viewModel) {
        viewModel.errors.collect { snackbar.showSnackbar(it.message ?: it.code) }
    }
    LifecycleResumeEffect(viewModel) {
        viewModel.onResumed()
        onPauseOrDispose { viewModel.onPaused() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Title(title, status) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        Column(Modifier.padding(padding).consumeWindowInsets(padding).fillMaxSize()) {
            chatError?.let { ChatUnavailable(it) }
            ChatTab(
                events = events,
                onOpenThread = onOpenThread,
                onAnswer = viewModel::answer,
                onFocusComposer = null,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun Title(title: String, status: String?) {
    Column {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        if (status != null) {
            Text(
                text = status,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
