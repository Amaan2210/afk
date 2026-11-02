package io.github.amaankhan63.afk.ui.session.terminal

import android.view.KeyEvent
import android.view.MotionEvent
import com.termux.terminal.TerminalSession
import com.termux.view.TerminalViewClient
import io.github.amaankhan63.afk.ui.session.KeyBarState

/** The font sizes a pinch can reach. */
const val MIN_FONT_SP = 8
const val MAX_FONT_SP = 32

// A pinch changes the font size by one step once it has scaled by 10% either way.
private const val PINCH_IN = 0.9f
private const val PINCH_OUT = 1.1f

/**
 * TerminalView's client: keys are left to the view, which writes them to the session, and a pinch
 * steps the font size through [onFontSizeChange]. The key bar's Ctrl, while [keyBar]'s is armed,
 * holds Ctrl down for the next character typed into the view. A long press starts the view's text
 * selection, whose Copy and Paste reach [AfkTerminalSession]. Logs are dropped: they can quote
 * what is typed.
 */
internal class TerminalHostClient(
    private val fontSizeSp: () -> Int,
    private val onFontSizeChange: (Int) -> Unit,
    private val keyBar: () -> KeyBarState? = { null }
) : TerminalViewClient {
    /** [scale] is the pinch gathered so far; TerminalView keeps what this returns. */
    override fun onScale(scale: Float): Float {
        if (scale in PINCH_IN..PINCH_OUT) return scale
        val current = fontSizeSp()
        val next = (if (scale > 1f) current + 1 else current - 1).coerceIn(MIN_FONT_SP, MAX_FONT_SP)
        if (next != current) onFontSizeChange(next)
        return 1f
    }

    /**
     * True, as in Termux while the terminal has focus: the keyboard then sends every key as typed.
     * As a plain text field it would offer suggestions and autocorrect, and hold letters back until
     * a word is done.
     */
    override fun isTerminalViewSelected(): Boolean = true

    override fun onSingleTapUp(e: MotionEvent?) = Unit

    override fun shouldBackButtonBeMappedToEscape(): Boolean = false

    override fun shouldEnforceCharBasedInput(): Boolean = false

    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false

    override fun copyModeChanged(copyMode: Boolean) = Unit

    override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?): Boolean = false

    override fun onKeyUp(keyCode: Int, e: KeyEvent?): Boolean = false

    override fun onLongPress(event: MotionEvent?): Boolean = false

    /**
     * Whether the key bar's Ctrl is armed. Asking never uses it up: TerminalView also asks on
     * every hardware key event, Shift included. [onCodePoint] uses it up.
     */
    override fun readControlKey(): Boolean = keyBar()?.ctrlArmed == true

    override fun readAltKey(): Boolean = false

    override fun readShiftKey(): Boolean = false

    override fun readFnKey(): Boolean = false

    /**
     * A character typed into the view: an armed Ctrl, which [readControlKey] has just applied to
     * it, is used up. False: TerminalView writes the character, as a control character if so.
     */
    override fun onCodePoint(
        codePoint: Int,
        ctrlDown: Boolean,
        session: TerminalSession?
    ): Boolean {
        keyBar()?.disarm()
        return false
    }

    override fun onEmulatorSet() = Unit

    override fun logError(tag: String?, message: String?) = Unit

    override fun logWarn(tag: String?, message: String?) = Unit

    override fun logInfo(tag: String?, message: String?) = Unit

    override fun logDebug(tag: String?, message: String?) = Unit

    override fun logVerbose(tag: String?, message: String?) = Unit

    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) = Unit

    override fun logStackTrace(tag: String?, e: Exception?) = Unit
}
