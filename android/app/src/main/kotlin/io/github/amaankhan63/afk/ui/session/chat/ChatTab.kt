package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.launch

/**
 * The Chat tab: the thread's [events], oldest first; nothing until the thread's first snapshot,
 * rather than "No messages yet" for a thread that may have many. A sub-agent's card opens its
 * thread through [onOpenThread]; a question's or permission's card answers through [onAnswer],
 * which says whether the answer went out; "Other…" focuses the composer through
 * [onFocusComposer], and is not offered without one (a sub-agent's thread).
 *
 * The list keeps its end in view, through new events and a keyboard shrinking it, until the reader
 * scrolls away from the end; scrolling back to the end makes it follow again.
 */
@Composable
fun ChatTab(
    events: List<ChatEvent>?,
    onOpenThread: (String) -> Unit,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Boolean,
    onFocusComposer: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val rows = remember(events) { events?.filter(::hasRow) }
    val list = rememberLazyListState()
    // The ids of the tool cards opened, and whether the list keeps its end in view.
    var expanded by rememberSaveable { mutableStateOf(listOf<String>()) }
    var pinned by rememberSaveable { mutableStateOf(true) }

    // Only a reader's scroll moves the pin: one that starts with a drag, sampled once it (and its
    // fling) ends. The list's own jumps below never do.
    LaunchedEffect(list) {
        var dragged = false
        launch {
            list.interactionSource.interactions
                .filterIsInstance<DragInteraction.Start>()
                .collect { dragged = true }
        }
        snapshotFlow { list.isScrollInProgress }.collect { scrolling ->
            pinned = nextPinned(pinned, scrollEnded = dragged && !scrolling, list.canScrollForward)
            if (!scrolling) dragged = false
        }
    }
    // An append, or a keyboard shrinking the list, keeps a pinned list's end in view.
    LaunchedEffect(list, rows?.size) {
        snapshotFlow { list.layoutInfo.viewportSize.height }.collect {
            if (pinned && !rows.isNullOrEmpty()) list.jumpTo(rows.lastIndex)
        }
    }

    if (rows == null) {
        Box(modifier.fillMaxSize())
    } else if (rows.isEmpty()) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No messages yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            state = list,
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            items(rows, key = { it.id }, contentType = { it.kind }) { event ->
                ChatEventRow(
                    event = event,
                    toolExpanded = event.id in expanded,
                    onToggleTool = { expanded = expanded.toggled(event.id) },
                    onOpenThread = onOpenThread,
                    onAnswer = onAnswer,
                    onFocusComposer = onFocusComposer
                )
            }
        }
    }
}

/**
 * Scrolls to row [index]. A reader's scroll in progress outranks it and makes it give up, and then
 * decides the pin itself when it ends; the caller keeps listening either way.
 */
private suspend fun LazyListState.jumpTo(index: Int) {
    try {
        scrollToItem(index)
    } catch (e: CancellationException) {
        currentCoroutineContext().ensureActive()
    }
}

/** This list without [item] if it holds it, or with it if it does not. */
internal fun <T> List<T>.toggled(item: T): List<T> = if (item in this) this - item else this + item

/** Why the thread cannot be shown, as a line above the list. */
@Composable
fun ChatUnavailable(error: AfkError, modifier: Modifier = Modifier) {
    Text(
        text = "Chat unavailable: ${error.message ?: error.code}",
        modifier = modifier.padding(horizontal = 14.dp, vertical = 4.dp),
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall
    )
}

/**
 * Whether the list keeps its end in view after a scroll state change. A reader's scroll that
 * [scrollEnded] pins the list when it ended at the end (it cannot [canScrollForward]) and unpins
 * it when it ended above; nothing else moves the pin, so an append or a keyboard, which leave the
 * list able to scroll on, do not unpin it.
 */
internal fun nextPinned(
    wasPinned: Boolean,
    scrollEnded: Boolean,
    canScrollForward: Boolean
): Boolean = if (scrollEnded) !canScrollForward else wasPinned

/** Whether [event] takes a row: every event but a turn's end, which draws nothing. */
internal fun hasRow(event: ChatEvent): Boolean =
    event.kind != ChatKind.turn || event.turn?.phase == TURN_START
