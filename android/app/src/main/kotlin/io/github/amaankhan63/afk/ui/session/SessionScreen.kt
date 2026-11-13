package io.github.amaankhan63.afk.ui.session

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
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
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.ui.session.chat.ChatTab
import io.github.amaankhan63.afk.ui.session.terminal.TerminalTab
import io.github.amaankhan63.afk.ui.settings.AppSettingsViewModel
import io.github.amaankhan63.afk.ui.theme.LocalAfkDark
import io.github.amaankhan63.afk.ui.theme.LocalAfkThemeId
import io.github.amaankhan63.afk.ui.theme.Palettes
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** How often a working session's time is brought up to date. */
private const val CLOCK_TICK_MS = 30_000L

/** What follows a command sent from the Chat tab, whose menu or output only the terminal shows. */
private const val COMMAND_NOTE = "Commands show their result in the Terminal tab"

/**
 * One session. An agent's session has a Terminal and a Chat tab, which the segmented control
 * switches (and a swipe, when Settings allows it); a shell has only its terminal. Typing on the
 * Terminal tab goes straight into the terminal; the Chat tab has the composer. The view model
 * reads the session's id from the route's `id`; [sessionId] keys it. [onOpenSession] opens the
 * session a resume started.
 *
 * While the screen is started its terminal is attached, and while it is resumed the session's
 * notifications are held back.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SessionScreen(
    sessionId: String,
    onBack: () -> Unit,
    onOpenThread: (String) -> Unit,
    onOpenSession: (String) -> Unit = {}
) {
    val viewModel: SessionViewModel = hiltViewModel(key = sessionId)
    val appSettings: AppSettingsViewModel = hiltViewModel()
    val state by viewModel.ui.collectAsStateWithLifecycle()
    val settings by appSettings.settings.collectAsStateWithLifecycle()
    val failure by viewModel.bridge.failure.collectAsStateWithLifecycle()
    val chatError by viewModel.chat.error.collectAsStateWithLifecycle()
    // The field's text lives here, not in the round trip through the view model's flows: a
    // recomposition before that trip ends would put stale text back under the keyboard.
    var composer by rememberSaveable { mutableStateOf(viewModel.ui.value.composer) }
    val keyBarState = remember { KeyBarState() }
    val composerFocus = remember { FocusRequester() }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf(Instant.now()) }
    val session = state.session
    // A shell has no chat, and neither has a session not heard of yet.
    val hasChat = session != null && session.kind != SessionKind.shell
    val tabs = if (hasChat) SessionTab.entries else listOf(SessionTab.Terminal)
    val tab = if (hasChat) state.tab else SessionTab.Terminal
    val pager = rememberPagerState(initialPage = tab.ordinal) { tabs.size }
    // While typing into the terminal every line counts: the tabs and the strip give theirs up.
    val typingInTerminal = WindowInsets.isImeVisible && tab == SessionTab.Terminal
    val terminalColors = Palettes.terminal(
        LocalAfkThemeId.current,
        dark = settings.alwaysDarkTerminal || LocalAfkDark.current
    )

    // After process death the field gets its text back but the view model starts empty.
    LaunchedEffect(viewModel) { viewModel.onComposer(composer) }
    val openSession by rememberUpdatedState(onOpenSession)
    LaunchedEffect(viewModel) {
        viewModel.errors.collect { snackbar.showSnackbar(it.message ?: it.code) }
    }
    LaunchedEffect(viewModel) { viewModel.resumed.collect { openSession(it) } }
    val back by rememberUpdatedState(onBack)
    // Killed or deleted: back to the list, where an ended card stays for Resume and Delete.
    LaunchedEffect(viewModel) { viewModel.closed.collect { back() } }
    LaunchedEffect(chatError, hasChat) {
        val error = chatError
        if (hasChat && error != null) {
            snackbar.showSnackbar("Chat unavailable: ${error.message ?: error.code}")
        }
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
    LaunchedEffect(tab, tabs.size) {
        keyBarState.disarm()
        val page = tabs.indexOf(tab).coerceAtLeast(0)
        if (pager.currentPage != page || pager.currentPageOffsetFraction != 0f) {
            pager.animateScrollToPage(page)
        }
    }
    LaunchedEffect(pager, hasChat) {
        // A terminal alone has no tab to select.
        if (!hasChat) return@LaunchedEffect
        snapshotFlow { pager.settledPage }.collect {
            val settled = SessionTab.entries.getOrNull(it) ?: return@collect
            viewModel.selectTab(settled)
            // The laptop may have resized the terminal while it was out of sight.
            if (settled == SessionTab.Terminal) viewModel.bridge.reclaimGrid()
        }
    }

    Scaffold(
        topBar = {
            SessionTopBar(
                session = session,
                workingSince = state.workingSince,
                now = now,
                onBack = onBack,
                onRename = viewModel::rename,
                onKill = viewModel::kill,
                onResume = viewModel::resume,
                onCopied = { scope.launch { snackbar.showSnackbar("Copied") } },
                muted = sessionId in settings.mutedSessions,
                onMute = { appSettings.setMuted(sessionId, it) },
                onDelete = viewModel::kill
            )
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        // Above the keyboard, so the terminal shrinks and sends its new grid when it opens.
        Column(Modifier.padding(padding).consumeWindowInsets(padding).imePadding().fillMaxSize()) {
            if (!typingInTerminal) {
                if (hasChat) SessionTabs(tab, viewModel::selectTab)
                StatusStrip(state.shownChips, Modifier.padding(bottom = 6.dp))
            }
            // One page beyond the viewport stays composed: a swipe keeps the terminal's view.
            HorizontalPager(
                state = pager,
                modifier = Modifier.weight(1f),
                beyondViewportPageCount = 1,
                userScrollEnabled = settings.swipeTabs
            ) { page ->
                when (tabs.getOrElse(page) { SessionTab.Terminal }) {
                    SessionTab.Terminal -> TerminalTab(
                        bridge = viewModel.bridge,
                        colors = terminalColors,
                        fontSizeSp = settings.terminalFontSp,
                        // Saved, so Settings and the next session open at the pinched size.
                        onFontSizeChange = appSettings::setFontSize,
                        keyBar = settings.keyBar,
                        keyBarState = keyBarState,
                        onBytes = viewModel::sendKeys,
                        onToggleKeyboard = { viewModel.bridge.toggleKeyboard?.invoke() },
                        failure = failure,
                        onRetry = viewModel::attachTerminal,
                        // A shell's commands are not words: its keys go out as typed.
                        wordSuggestions = settings.wordSuggestions &&
                            session?.kind != SessionKind.shell,
                        prompt = session?.pending,
                        onAnswer = viewModel::answer
                    )

                    SessionTab.Chat -> Column {
                        val events by viewModel.chat.events.collectAsStateWithLifecycle()
                        ChatTab(
                            events = events,
                            onOpenThread = onOpenThread,
                            onAnswer = viewModel::answer,
                            onFocusComposer = { composerFocus.requestFocus() },
                            modifier = Modifier.weight(1f)
                        )
                        Composer(
                            value = composer,
                            onChange = { text ->
                                // With Ctrl armed, one typed character goes out as its control
                                // character.
                                val control = keyBarState.typed(composer, text)
                                if (control != null) {
                                    viewModel.sendKeys(control)
                                } else {
                                    composer = text
                                    viewModel.onComposer(text)
                                }
                            },
                            // While not connected the text stays, for a send once the connection
                            // is back.
                            onSend = {
                                val command = composer.trimStart().startsWith("/")
                                if (viewModel.sendLine()) {
                                    composer = ""
                                    if (command) {
                                        scope.launch {
                                            val tapped = snackbar.showSnackbar(
                                                message = COMMAND_NOTE,
                                                actionLabel = "Terminal",
                                                duration = SnackbarDuration.Short
                                            )
                                            if (tapped == SnackbarResult.ActionPerformed) {
                                                viewModel.selectTab(SessionTab.Terminal)
                                            }
                                        }
                                    }
                                }
                            },
                            placeholder = state.composerPlaceholder,
                            modifier = Modifier.focusRequester(composerFocus)
                        )
                    }
                }
            }
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
