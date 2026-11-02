package io.github.amaankhan63.afk.ui.session.terminal

import android.graphics.Typeface
import android.view.KeyEvent
import android.view.MotionEvent
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
import com.termux.view.TerminalViewClient
import io.github.amaankhan63.afk.ui.theme.TerminalColors

/** The font sizes a pinch can reach. */
const val MIN_FONT_SP = 8
const val MAX_FONT_SP = 32

// A pinch changes the font size by one step once it has scaled by 10% either way.
private const val PINCH_IN = 0.9f
private const val PINCH_OUT = 1.1f

private const val ANSI_COLORS = 16

/** Termux's colour slots AFK sets: the 16 ANSI colours, then foreground, background, cursor. */
private val COLOR_SLOTS = (0 until ANSI_COLORS) + listOf(
    TextStyle.COLOR_INDEX_FOREGROUND,
    TextStyle.COLOR_INDEX_BACKGROUND,
    TextStyle.COLOR_INDEX_CURSOR
)

/**
 * The terminal of [bridge]'s session in Termux's TerminalView, in [colors] and at [fontSizeSp].
 * The view reports its grid to the bridge on every layout; a pinch asks [onFontSizeChange] for a
 * size one step larger or smaller, within [MIN_FONT_SP]..[MAX_FONT_SP].
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
                    val redraw = this::onScreenUpdated
                    shown.redraw = redraw
                    bridge.onScreenChanged = redraw
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
            onRelease = {
                // Another TerminalHost may have taken the bridge over meanwhile.
                if (bridge.onScreenChanged === shown.redraw) bridge.onScreenChanged = null
            }
        )
    }
}

/** What one TerminalHost has given its view, so that recompositions redo only what changed. */
private class Shown {
    var textSizePx = 0
    var colors: TerminalColors? = null
    var redraw: (() -> Unit)? = null
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

/**
 * TerminalView's client: keys are left to the view, which writes them to the session, and a pinch
 * steps the font size through [onFontSizeChange]. Logs are dropped: they can quote what is typed.
 */
internal class TerminalHostClient(
    private val fontSizeSp: () -> Int,
    private val onFontSizeChange: (Int) -> Unit
) : TerminalViewClient {
    /** [scale] is the pinch gathered so far; TerminalView keeps what this returns. */
    override fun onScale(scale: Float): Float {
        if (scale in PINCH_IN..PINCH_OUT) return scale
        val current = fontSizeSp()
        val next = (if (scale > 1f) current + 1 else current - 1).coerceIn(MIN_FONT_SP, MAX_FONT_SP)
        if (next != current) onFontSizeChange(next)
        return 1f
    }

    override fun isTerminalViewSelected(): Boolean = false

    override fun onSingleTapUp(e: MotionEvent?) = Unit

    override fun shouldBackButtonBeMappedToEscape(): Boolean = false

    override fun shouldEnforceCharBasedInput(): Boolean = false

    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false

    override fun copyModeChanged(copyMode: Boolean) = Unit

    override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?): Boolean = false

    override fun onKeyUp(keyCode: Int, e: KeyEvent?): Boolean = false

    override fun onLongPress(event: MotionEvent?): Boolean = false

    override fun readControlKey(): Boolean = false

    override fun readAltKey(): Boolean = false

    override fun readShiftKey(): Boolean = false

    override fun readFnKey(): Boolean = false

    override fun onCodePoint(
        codePoint: Int,
        ctrlDown: Boolean,
        session: TerminalSession?
    ): Boolean = false

    override fun onEmulatorSet() = Unit

    override fun logError(tag: String?, message: String?) = Unit

    override fun logWarn(tag: String?, message: String?) = Unit

    override fun logInfo(tag: String?, message: String?) = Unit

    override fun logDebug(tag: String?, message: String?) = Unit

    override fun logVerbose(tag: String?, message: String?) = Unit

    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) = Unit

    override fun logStackTrace(tag: String?, e: Exception?) = Unit
}
