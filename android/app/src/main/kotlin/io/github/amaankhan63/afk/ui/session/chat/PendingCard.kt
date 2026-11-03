package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

private const val TINT_ALPHA = 0.09f
private const val BORDER_ALPHA = 0.45f

/** `pending.answer` decisions of a permission prompt. */
private const val ALLOW = "allow"
private const val ALWAYS = "allow_always"
private const val DENY = "deny"

/**
 * A prompt the agent waits on, answered through [onAnswer], which says whether the answer went
 * out. A question's option answers it at once, or, for a question that takes several, once Confirm
 * is tapped; once its answer went out, its options are off. A question that takes a typed answer
 * offers "Other…", which goes to the composer through [onFocusComposer], whose text then answers
 * it; there is none without a composer. A permission is allowed once, always, or denied.
 *
 * The card stays answerable after the prompt has moved on elsewhere: the daemon refuses such an
 * answer, and the screen says so.
 */
@Composable
fun PendingCard(
    pending: Pending,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Boolean,
    onFocusComposer: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val amber = LocalAfkPalette.current.amber
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = amber.copy(alpha = TINT_ALPHA)
            .compositeOver(MaterialTheme.colorScheme.surfaceContainerLow),
        border = BorderStroke(1.dp, amber.copy(alpha = BORDER_ALPHA))
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            when (pending) {
                is Pending.Question -> Question(pending, onAnswer, onFocusComposer)
                is Pending.Permission -> Permission(pending, onAnswer)
            }
        }
    }
}

@Composable
private fun Permission(
    permission: Pending.Permission,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Boolean
) {
    val decide = { decision: String -> onAnswer(permission.id, null, null, decision) }
    val type = MaterialTheme.typography
    val deny = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
    Text(permission.tool, fontWeight = FontWeight.SemiBold, style = type.bodyMedium)
    Text(permission.summary, fontFamily = FontFamily.Monospace, style = type.bodySmall)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button({ decide(ALLOW) }, Modifier.weight(1f)) { Text("Allow") }
        OutlinedButton({ decide(ALWAYS) }, Modifier.weight(1f)) { Text("Always") }
        OutlinedButton({ decide(DENY) }, Modifier.weight(1f), colors = deny) { Text("Deny") }
    }
}
