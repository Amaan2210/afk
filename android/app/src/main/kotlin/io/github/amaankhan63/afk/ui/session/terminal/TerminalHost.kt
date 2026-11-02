package io.github.amaankhan63.afk.ui.session.terminal

import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Typeface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.termux.terminal.TerminalColors as EmulatorColors
import com.termux.terminal.TerminalSession
import com.termux.terminal.TextStyle
import com.termux.view.TerminalView
import io.github.amaankhan63.afk.ui.theme.TerminalColors

private const val ANSI_COLORS = 16

private const val CLIP_LABEL = "AFK terminal"

/** Termux's colour slots AFK sets: the 16 ANSI colours, then foreground, background, cursor. */
private val COLOR_SLOTS = (0 until ANSI_COLORS) + listOf(
    TextStyle.COLOR_INDEX_FOREGROUND,
    TextStyle.COLOR_INDEX_BACKGROUND,
    TextStyle.COLOR_INDEX_CURSOR
)

/**
 * The terminal of [bridge]'s session in Termux's TerminalView, in [colors] and at [fontSizeSp].
 * The view reports its grid to the bridge on every layout; a pinch asks [onFontSizeChange] for a
 * size one step larger or smaller, within [MIN_FONT_SP]..[MAX_FONT_SP]. A long press selects text,
 * and its Copy and Paste use the system clipboard.
 *
 * Termux keeps its default colours process-wide, so every TerminalHost shows the [colors] set last.
 */
@Composable
fun TerminalHost(
    bridge: TerminalBridge,
    colors: TerminalColors,
    fontSizeSp: Int,
    onFontSizeChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val textSizePx = with(LocalDensity.current) { fontSizeSp.sp.roundToPx() }
    val currentFontSizeSp by rememberUpdatedState(fontSizeSp)
    val currentOnFontSizeChange by rememberUpdatedState(onFontSizeChange)
    // Another session's bridge gets a view of its own.
    key(bridge) {
        val shown = remember { Shown() }
        AndroidView(
            factory = { context ->
                TerminalView(context, null).apply {
                    setTerminalViewClient(
                        TerminalHostClient({ currentFontSizeSp }, { currentOnFontSizeChange(it) })
                    )
                    isFocusable = true
                    isFocusableInTouchMode = true
                    setTextSize(textSizePx)
                    setTypeface(Typeface.MONOSPACE)
                    shown.textSizePx = textSizePx
                    takeOver(bridge, shown)
                    attachSession(bridge.session)
                }
            },
            modifier = modifier,
            update = { view ->
                if (shown.textSizePx != textSizePx) {
                    view.setTextSize(textSizePx)
                    shown.textSizePx = textSizePx
                }
                if (shown.colors != colors) {
                    view.applyColors(colors, bridge.session)
                    shown.colors = colors
                }
            },
            onRelease = { bridge.release(shown) }
        )
    }
}

/** What one TerminalHost has given its view, so that recompositions redo only what changed. */
private class Shown {
    var textSizePx = 0
    var colors: TerminalColors? = null
    var redraw: (() -> Unit)? = null
}

/** Points [bridge]'s redraw at this view, and its session's copy and paste at the clipboard. */
private fun TerminalView.takeOver(bridge: TerminalBridge, shown: Shown) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    val redraw = this::onScreenUpdated
    shown.redraw = redraw
    bridge.onScreenChanged = redraw
    bridge.session.onCopyText = { text ->
        clipboard?.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, text))
    }
    bridge.session.onPasteRequest = {
        clipboard?.primaryClip
            ?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)
            ?.coerceToText(context)
            ?.toString()
    }
}

/** Undoes [takeOver], unless another TerminalHost has taken the bridge over meanwhile. */
private fun TerminalBridge.release(shown: Shown) {
    if (onScreenChanged !== shown.redraw) return
    onScreenChanged = null
    session.onCopyText = null
    session.onPasteRequest = null
}

/**
 * Makes [colors] Termux's default colours, which every terminal reset returns to (each snapshot
 * resets the terminal), and shows them now.
 */
private fun TerminalView.applyColors(colors: TerminalColors, session: TerminalSession) {
    val defaults = EmulatorColors.COLOR_SCHEME.mDefaultColors
    colors.ansi16.take(ANSI_COLORS).forEachIndexed { slot, color ->
        defaults[slot] = color.toArgb()
    }
    defaults[TextStyle.COLOR_INDEX_FOREGROUND] = colors.foreground.toArgb()
    defaults[TextStyle.COLOR_INDEX_BACKGROUND] = colors.background.toArgb()
    defaults[TextStyle.COLOR_INDEX_CURSOR] = colors.cursor.toArgb()
    val current = session.emulator?.mColors
    if (current != null) COLOR_SLOTS.forEach { current.reset(it) }
    invalidate()
}
