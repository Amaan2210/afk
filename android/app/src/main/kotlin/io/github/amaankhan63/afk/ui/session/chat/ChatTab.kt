package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.github.amaankhan63.afk.data.protocol.ChatEvent

/**
 * The Chat tab: the session's [events]. A sub-agent's card opens its thread through
 * [onOpenThread]; a question's or permission's card answers through [onAnswer]; "Other…" focuses
 * the composer through [onFocusComposer].
 *
 * A placeholder until the chat renderer (Task 11) replaces its body.
 */
@Suppress("UNUSED_PARAMETER") // The renderer that replaces this body uses them.
@Composable
fun ChatTab(
    events: List<ChatEvent>,
    onOpenThread: (String) -> Unit,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Unit,
    onFocusComposer: () -> Unit
) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("Chat", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
