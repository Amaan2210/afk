package io.github.amaankhan63.afk.ui.session.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.ui.session.takesText
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

private const val TINT_ALPHA = 0.09f
private const val BORDER_ALPHA = 0.45f
private val NUMBER_SIZE = 18.dp

/** `pending.answer` decisions of a permission prompt. */
private const val ALLOW = "allow"
private const val ALWAYS = "allow_always"
private const val DENY = "deny"

/**
 * A prompt the agent waits on, answered through [onAnswer]. A question's option answers it at once,
 * or, for a question that takes several, once Confirm is tapped. A question that takes a typed
 * answer offers "Other…", which goes to the composer through [onFocusComposer], whose text then
 * answers it; there is none without a composer. A permission is allowed once, always, or denied.
 *
 * The card stays answerable after the prompt has moved on: the daemon refuses such an answer, and
 * the screen says so.
 */
@Composable
fun PendingCard(
    pending: Pending,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Unit,
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
private fun Question(
    question: Pending.Question,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Unit,
    onFocusComposer: (() -> Unit)?
) {
    val multi = question.multiSelect
    val type = MaterialTheme.typography
    // The options ticked so far, when the question takes several.
    var ticked by rememberSaveable(question.id) { mutableStateOf(listOf<Int>()) }
    Text(question.text, fontWeight = FontWeight.SemiBold, style = type.bodyMedium)
    question.options.forEachIndexed { index, option ->
        Choice(
            label = option.label,
            description = option.description,
            recommended = option.recommended,
            selected = index in ticked,
            lead = { if (multi) Checkbox(index in ticked, null) else Number(index + 1) },
            onClick = {
                if (multi) {
                    ticked = ticked.toggled(index)
                } else {
                    onAnswer(question.id, listOf(index), null, null)
                }
            }
        )
    }
    if (offersOther(question, hasComposer = onFocusComposer != null)) {
        Choice(
            label = "Other…",
            lead = { Number(question.options.size + 1) },
            onClick = { onFocusComposer?.invoke() }
        )
    }
    if (multi) {
        Button(
            onClick = { onAnswer(question.id, ticked.sorted(), null, null) },
            enabled = ticked.isNotEmpty()
        ) { Text("Confirm") }
    }
}

/** One answer of a question, as a button; [lead] is its number or checkbox. */
@Composable
private fun Choice(
    label: String,
    onClick: () -> Unit,
    lead: @Composable () -> Unit,
    description: String? = null,
    recommended: Boolean = false,
    selected: Boolean = false
) {
    val colors = MaterialTheme.colorScheme
    val type = MaterialTheme.typography
    val palette = LocalAfkPalette.current
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().semantics { role = Role.Button },
        shape = MaterialTheme.shapes.small,
        color = if (selected) palette.accentSoft else colors.surfaceContainerLow,
        border = BorderStroke(1.dp, if (selected) palette.accent else colors.outline)
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            lead()
            Column(Modifier.weight(1f)) {
                Text(label, style = type.bodySmall)
                description?.let {
                    Text(it, color = colors.onSurfaceVariant, style = type.labelSmall)
                }
            }
            if (recommended) {
                Text(
                    text = "RECOMMENDED",
                    color = palette.green,
                    fontWeight = FontWeight.Bold,
                    style = type.labelSmall
                )
            }
        }
    }
}

/** An option's number in a small disc, as the agent's terminal prompt numbers it. */
@Composable
private fun Number(n: Int) {
    val colors = MaterialTheme.colorScheme
    Text(
        text = "$n",
        modifier = Modifier
            .size(NUMBER_SIZE)
            .background(colors.surfaceContainerHighest, CircleShape)
            .wrapContentSize(),
        color = colors.onSurfaceVariant,
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.labelSmall
    )
}

@Composable
private fun Permission(
    permission: Pending.Permission,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Unit
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

/**
 * Whether [question]'s card offers "Other…": only where the composer's text answers it, so on a
 * screen [hasComposer], for a question that takes typed text and a single answer.
 */
internal fun offersOther(question: Pending.Question, hasComposer: Boolean): Boolean =
    hasComposer && question.takesText
