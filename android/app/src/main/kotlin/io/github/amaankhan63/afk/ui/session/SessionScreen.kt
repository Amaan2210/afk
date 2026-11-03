package io.github.amaankhan63.afk.ui.session

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.amaankhan63.afk.ui.session.chat.ChatTab
import io.github.amaankhan63.afk.ui.session.chat.ChatUnavailable
import io.github.amaankhan63.afk.ui.session.terminal.TerminalTab
import io.github.amaankhan63.afk.ui.theme.AfkThemeId
import io.github.amaankhan63.afk.ui.theme.Palettes
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The terminal's font size and the key bar's visibility, until Settings holds them (Task 14). */
private const val DEFAULT_FONT_SP = 12
private const val KEY_BAR = true

/** How often a working session's time is brought up to date. */
private const val CLOCK_TICK_MS = 30_000L

/**
 * One session: its Terminal and Chat tabs, which the segmented control and a swipe switch, with
 * the status strip and the composer under both. The view model reads the session's id from the
 * route's `id`; [sessionId] keys it. [onOpenSession] opens the session a resume started.
 *
 * While the screen is started its terminal is attached, and while it is resumed the session's
 * notifications are held back.
 */
@Composable
fun SessionScreen(
    sessionId: String,
    onBack: () -> Unit,
    onOpenThread: (String) -> Unit,
    onOpenSession: (String) -> Unit = {}
) {
    val viewModel: SessionViewModel = hiltViewModel(key = sessionId)
    val state by viewModel.ui.collectAsStateWithLifecycle()
    val failure by viewModel.bridge.failure.collectAsStateWithLifecycle()
    // The field's text lives here, not in the round trip through the view model's flows: a
    // recomposition before that trip ends would put stale text back under the keyboard.
    var composer by rememberSaveable { mutableStateOf(viewModel.ui.value.composer) }
    var fontSizeSp by rememberSaveable { mutableIntStateOf(DEFAULT_FONT_SP) }
    val keyBarState = remember { KeyBarState() }
    val composerFocus = remember { FocusRequester() }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf(Instant.now()) }
    val pager = rememberPagerState(initialPage = state.tab.ordinal) { SessionTab.entries.size }
    // Graphite until Settings holds the theme and Always dark terminal (Task 14).
    val terminalColors = Palettes.terminal(AfkThemeId.Graphite, dark = isSystemInDarkTheme())

    // After process death the field gets its text back but the view model starts empty.
    LaunchedEffect(viewModel) { viewModel.onComposer(composer) }
    LaunchedEffect(viewModel) {
        viewModel.errors.collect { snackbar.showSnackbar(it.message ?: it.code) }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(CLOCK_TICK_MS)
            now = Instant.now()
        }
    }
    LifecycleStartEffect(viewModel) {
        viewModel.attachTerminal()
        onStopOrDispose { viewModel.detachTerminal() }
    }
    LifecycleResumeEffect(viewModel) {
        viewModel.onResumed()
        onPauseOrDispose { viewModel.onPaused() }
    }
    // The segmented control moves the pager, also out of a scroll it cut short, and a swipe, once
    // it settles, selects the tab. Ctrl armed on one tab does not carry over to the other.
    LaunchedEffect(state.tab) {
        keyBarState.disarm()
        val page = state.tab.ordinal
        if (pager.currentPage != page || pager.currentPageOffsetFraction != 0f) {
            pager.animateScrollToPage(page)
        }
    }
    LaunchedEffect(pager) {
        snapshotFlow { pager.settledPage }.collect {
            val tab = SessionTab.entries[it]
            viewModel.selectTab(tab)
            // The laptop may have resized the terminal while it was out of sight.
            if (tab == SessionTab.Terminal) viewModel.bridge.reclaimGrid()
        }
    }

    Scaffold(
        topBar = {
            SessionTopBar(
                session = state.session,
                workingSince = state.workingSince,
                now = now,
                onBack = onBack,
                onRename = viewModel::rename,
                onKill = viewModel::kill,
                onResume = { viewModel.resume(onOpenSession) },
                onCopied = { scope.launch { snackbar.showSnackbar("Copied") } }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        // Above the keyboard, so the terminal shrinks and sends its new grid when it opens.
        Column(Modifier.padding(padding).consumeWindowInsets(padding).imePadding().fillMaxSize()) {
            SessionTabs(state.tab, viewModel::selectTab)
            // One page beyond the viewport stays composed: a swipe keeps the terminal's view.
            HorizontalPager(pager, Modifier.weight(1f), beyondViewportPageCount = 1) { page ->
                when (SessionTab.entries[page]) {
                    SessionTab.Terminal -> TerminalTab(
                        bridge = viewModel.bridge,
                        colors = terminalColors,
                        fontSizeSp = fontSizeSp,
                        onFontSizeChange = { fontSizeSp = it },
                        keyBar = KEY_BAR,
                        keyBarState = keyBarState,
                        onBytes = viewModel::sendKeys,
                        onToggleKeyboard = { viewModel.bridge.toggleKeyboard?.invoke() },
                        failure = failure,
                        onRetry = viewModel::attachTerminal
                    )

                    SessionTab.Chat -> Column {
                        val events by viewModel.chat.events.collectAsStateWithLifecycle()
                        val chatError by viewModel.chat.error.collectAsStateWithLifecycle()
                        chatError?.let { ChatUnavailable(it) }
                        ChatTab(
                            events = events,
                            onOpenThread = onOpenThread,
                            onAnswer = viewModel::answer,
                            onFocusComposer = { composerFocus.requestFocus() },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }
            StatusStrip(state.shownChips)
            Composer(
                value = composer,
                onChange = { text ->
                    // With Ctrl armed, one typed character goes out as its control character.
                    val control = keyBarState.typed(composer, text)
                    if (control != null) {
                        viewModel.sendKeys(control)
                    } else {
                        composer = text
                        viewModel.onComposer(text)
                    }
                },
                // While not connected the text stays, for a send once the connection is back.
                onSend = { if (viewModel.sendLine()) composer = "" },
                placeholder = state.composerPlaceholder,
                modifier = Modifier.focusRequester(composerFocus)
            )
        }
    }
}

@Composable
private fun SessionTabs(tab: SessionTab, onSelect: (SessionTab) -> Unit) {
    SingleChoiceSegmentedButtonRow(
        Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 6.dp)
    ) {
        SessionTab.entries.forEach {
            SegmentedButton(
                selected = it == tab,
                onClick = { onSelect(it) },
                shape = SegmentedButtonDefaults.itemShape(it.ordinal, SessionTab.entries.size),
                icon = {}
            ) { Text(it.name) }
        }
    }
}
