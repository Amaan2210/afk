package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ChatEvent
import io.github.amaankhan63.afk.data.protocol.ChatKind

/**
 * The Chat tab: the thread's [events], oldest first. A sub-agent's card opens its thread through
 * [onOpenThread]; a question's or permission's card answers through [onAnswer]; "Other…" focuses
 * the composer through [onFocusComposer].
 *
 * The list follows new events while its last one is in view, and stays put once scrolled up.
 */
@Composable
fun ChatTab(
    events: List<ChatEvent>,
    onOpenThread: (String) -> Unit,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Unit,
    onFocusComposer: () -> Unit,
    modifier: Modifier = Modifier
) {
    val rows = remember(events) { events.filter(::hasRow) }
    val list = rememberLazyListState()
    // The ids of the tool cards opened, and the last row as of the latest append check.
    var expanded by rememberSaveable { mutableStateOf(listOf<String>()) }
    var previousLast by rememberSaveable { mutableIntStateOf(-1) }

    LaunchedEffect(rows.lastIndex) {
        val lastVisible = list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
        val follow = shouldFollow(previousLast, rows.lastIndex, lastVisible)
        previousLast = rows.lastIndex
        // A jump, not an animation: the next append checks the rows laid out by then, and an
        // animation it cut short would leave the new row out of view and the list stopped.
        if (follow) list.scrollToItem(rows.lastIndex)
    }

    if (rows.isEmpty()) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No messages yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            state = list,
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
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
 * Whether the list scrolls to its new last row, [last]: only when rows were appended after
 * [previousLast] (-1 for none), and that row was in view, [lastVisible] being the last row laid
 * out. Whether or not the list has laid out the new rows yet, a reader who scrolled up sees an
 * earlier row last.
 */
internal fun shouldFollow(previousLast: Int, last: Int, lastVisible: Int): Boolean =
    last > previousLast && lastVisible >= previousLast

/** Whether [event] takes a row: every event but a turn's end, which draws nothing. */
internal fun hasRow(event: ChatEvent): Boolean =
    event.kind != ChatKind.turn || event.turn?.phase == TURN_START
