package io.github.amaankhan63.afk.ui.session

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.ui.session.terminal.TerminalKeys

private val KEY_SHAPE = RoundedCornerShape(9.dp)

enum class KeyBarKey { Esc, Tab, Ctrl, Up, Down, Left, Right, Enter, Keyboard }

/**
 * The key bar's Ctrl, sticky for one key: pressed, it arms, and the next character typed, in the
 * composer or into the terminal, goes out as its control character. Pressing Ctrl again, another
 * key of the bar, or a change of tab disarms it.
 */
class KeyBarState {
    var ctrlArmed: Boolean by mutableStateOf(false)
        private set

    /**
     * The bytes [key] sends. Null for Ctrl, which arms or disarms, and for Keyboard, which the
     * screen handles.
     */
    fun press(key: KeyBarKey): ByteArray? {
        if (key == KeyBarKey.Keyboard) return null
        if (key == KeyBarKey.Ctrl) {
            ctrlArmed = !ctrlArmed
            return null
        }
        ctrlArmed = false
        return when (key) {
            KeyBarKey.Esc -> TerminalKeys.ESC
            KeyBarKey.Tab -> TerminalKeys.TAB
            KeyBarKey.Up -> TerminalKeys.UP
            KeyBarKey.Down -> TerminalKeys.DOWN
            KeyBarKey.Left -> TerminalKeys.LEFT
            KeyBarKey.Right -> TerminalKeys.RIGHT
            KeyBarKey.Enter -> TerminalKeys.ENTER
            KeyBarKey.Ctrl, KeyBarKey.Keyboard -> null
        }
    }

    /** Drops an armed Ctrl, as when it was used in the terminal or the screen changed tabs. */
    fun disarm() {
        ctrlArmed = false
    }

    /** Ctrl+[c] when Ctrl is armed, which disarms it; null, leaving [c] alone, otherwise. */
    fun press(c: Char): ByteArray? {
        if (!ctrlArmed) return null
        ctrlArmed = false
        return TerminalKeys.ctrl(c)
    }

    /**
     * The control character to send instead of the edit from [before] to [after], when Ctrl is
     * armed and the edit types one printable character; null when the edit is the composer's.
     */
    fun typed(before: String, after: String): ByteArray? =
        if (ctrlArmed) insertedChar(before, after)?.let(::press) else null
}

/** The one printable character typed into [before] to make [after]; null for any other edit. */
internal fun insertedChar(before: String, after: String): Char? {
    if (after.length != before.length + 1) return null
    val at = before.commonPrefixWith(after).length
    val c = after[at]
    return c.takeIf { !it.isISOControl() && after.removeRange(at, at + 1) == before }
}

/**
 * The keys a phone keyboard lacks, in one row under the terminal. Keys send their bytes to
 * [onBytes]; Ctrl shows when it is armed; the keyboard key calls [onToggleKeyboard].
 */
@Composable
fun KeyBar(
    state: KeyBarState,
    onBytes: (ByteArray) -> Unit,
    onToggleKeyboard: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        KeyBarKey.entries.forEach { key ->
            val armed = key == KeyBarKey.Ctrl && state.ctrlArmed
            Key(
                key = key,
                armed = armed,
                modifier = Modifier.weight(1f),
                onClick = {
                    if (key == KeyBarKey.Keyboard) {
                        onToggleKeyboard()
                    } else {
                        state.press(key)?.let(onBytes)
                    }
                }
            )
        }
    }
}

@Composable
private fun Key(key: KeyBarKey, armed: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        modifier = modifier.semantics {
            contentDescription = description(key, armed)
            role = Role.Button
        },
        shape = KEY_SHAPE,
        color = if (armed) colors.primaryContainer else colors.surfaceContainerLow,
        border = BorderStroke(1.dp, if (armed) colors.primary else colors.outline)
    ) {
        Text(
            text = label(key),
            modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp),
            // Ctrl is a modifier, in the accent colour as in the design.
            color = if (key == KeyBarKey.Ctrl) colors.primary else colors.onSurface,
            style = MaterialTheme.typography.labelMedium,
            fontFamily = FontFamily.Monospace,
            textAlign = TextAlign.Center,
            maxLines = 1
        )
    }
}

private fun label(key: KeyBarKey): String = when (key) {
    KeyBarKey.Esc -> "Esc"
    KeyBarKey.Tab -> "Tab"
    KeyBarKey.Ctrl -> "Ctrl"
    KeyBarKey.Up -> "↑"
    KeyBarKey.Down -> "↓"
    KeyBarKey.Left -> "←"
    KeyBarKey.Right -> "→"
    KeyBarKey.Enter -> "⏎"
    KeyBarKey.Keyboard -> "⌨"
}

/** What a screen reader says for [key]: the arrows and symbols by name. */
private fun description(key: KeyBarKey, armed: Boolean): String = when (key) {
    KeyBarKey.Esc -> "Escape"
    KeyBarKey.Ctrl -> if (armed) "Control, armed" else "Control"
    KeyBarKey.Keyboard -> "Toggle keyboard"
    else -> key.name
}
