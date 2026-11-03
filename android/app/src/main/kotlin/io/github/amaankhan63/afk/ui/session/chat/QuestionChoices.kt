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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.ui.session.takesText
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

private val NUMBER_SIZE = 18.dp

/** How faint an option is once its question's answer went out, as Material dims disabled text. */
private const val ANSWERED_ALPHA = 0.38f

/**
 * A question's text and its options, as [PendingCard] shows them. Once [onAnswer] says the answer
 * went out, the options, Confirm and "Other…" are off: the daemon would refuse a second answer.
 */
@Composable
internal fun Question(
    question: Pending.Question,
    onAnswer: (pendingId: String, choices: List<Int>?, text: String?, decision: String?) -> Boolean,
    onFocusComposer: (() -> Unit)?
) {
    val multi = question.multiSelect
    val type = MaterialTheme.typography
    // The options ticked so far, when the question takes several.
    var ticked by rememberSaveable(question.id) { mutableStateOf(listOf<Int>()) }
    var answered by rememberSaveable(question.id) { mutableStateOf(false) }
    Text(question.text, fontWeight = FontWeight.SemiBold, style = type.bodyMedium)
    question.options.forEachIndexed { index, option ->
        Choice(
            label = option.label,
            description = option.description,
            recommended = option.recommended,
            checked = if (multi) index in ticked else null,
            enabled = !answered,
            lead = { if (multi) Checkbox(index in ticked, null) else Number(index + 1) },
            onClick = {
                if (multi) {
                    ticked = ticked.toggled(index)
                } else {
                    answered = onAnswer(question.id, listOf(index), null, null)
                }
            }
        )
    }
    if (offersOther(question, hasComposer = onFocusComposer != null)) {
        Choice(
            label = "Other…",
            enabled = !answered,
            lead = { Number(question.options.size + 1) },
            onClick = { onFocusComposer?.invoke() }
        )
    }
    if (multi) {
        Button(
            onClick = { answered = onAnswer(question.id, ticked.sorted(), null, null) },
            enabled = ticked.isNotEmpty() && !answered
        ) { Text("Confirm") }
    }
}

/**
 * One answer of a question; [lead] is its number or checkbox. A button, or, when [checked] is not
 * null, a checkbox row: the whole row ticks, and screen readers hear whether it is ticked. Not
 * [enabled], it is faint and takes no tap.
 */
@Composable
private fun Choice(
    label: String,
    onClick: () -> Unit,
    lead: @Composable () -> Unit,
    description: String? = null,
    recommended: Boolean = false,
    checked: Boolean? = null,
    enabled: Boolean = true
) {
    val colors = MaterialTheme.colorScheme
    val palette = LocalAfkPalette.current
    val selected = checked == true
    val color = if (selected) palette.accentSoft else colors.surfaceContainerLow
    val border = BorderStroke(1.dp, if (selected) palette.accent else colors.outline)
    val shape = MaterialTheme.shapes.small
    val content = @Composable { ChoiceContent(label, lead, description, recommended) }
    val modifier = Modifier.fillMaxWidth().alpha(if (enabled) 1f else ANSWERED_ALPHA)
    if (checked == null) {
        Surface(
            onClick = onClick,
            modifier = modifier.semantics { role = Role.Button },
            enabled = enabled,
            shape = shape,
            color = color,
            border = border,
            content = content
        )
    } else {
        // Toggleable, so the row carries the ticked state; the checkbox inside only draws it.
        Surface(
            checked = checked,
            onCheckedChange = { onClick() },
            modifier = modifier.semantics { role = Role.Checkbox },
            enabled = enabled,
            shape = shape,
            color = color,
            border = border,
            content = content
        )
    }
}

@Composable
private fun ChoiceContent(
    label: String,
    lead: @Composable () -> Unit,
    description: String?,
    recommended: Boolean
) {
    val colors = MaterialTheme.colorScheme
    val type = MaterialTheme.typography
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
                color = LocalAfkPalette.current.green,
                fontWeight = FontWeight.Bold,
                style = type.labelSmall
            )
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

/**
 * Whether [question]'s card offers "Other…": only where the composer's text answers it, so on a
 * screen [hasComposer], for a question that takes typed text and a single answer.
 */
internal fun offersOther(question: Pending.Question, hasComposer: Boolean): Boolean =
    hasComposer && question.takesText
