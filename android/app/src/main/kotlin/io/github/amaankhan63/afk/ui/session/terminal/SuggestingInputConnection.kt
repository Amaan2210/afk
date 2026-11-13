package io.github.amaankhan63.afk.ui.session.terminal

import android.text.Editable
import android.text.InputType
import android.text.Selection
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import com.termux.view.TerminalView

/** Past this many characters, once no word is being typed, the field starts again empty. */
private const val MAX_FIELD = 400

/**
 * The keyboard's link to the terminal while word suggestions are on. The keyboard sees a text
 * field, the same kind as Chat's, so it suggests and corrects words; every change to the field
 * reaches the laptop at once. The field holds what was typed since it was last emptied, and the
 * laptop has the same text at the end of its input: a change is sent as Backspaces for what no
 * longer matches, then the rest. A picked suggestion or a correction so becomes "delete the word,
 * type the new one".
 *
 * Enter, any other key, and a Ctrl the key bar applied leave the field out of step with the
 * laptop: [restart] then asks the keyboard for a new link, with an empty field. Until the keyboard
 * has moved to it, this one goes on sending, so no key typed meanwhile is lost. Keys go out
 * through [view], as TerminalView's own link sends them; [ctrlArmed] says whether the key bar's
 * Ctrl will apply to the next character.
 */
internal class SuggestingInputConnection(
    private val view: TerminalView,
    private val ctrlArmed: () -> Boolean,
    private val restart: () -> Unit
) : BaseInputConnection(view, true) {
    private val keyboard = view.context.getSystemService(InputMethodManager::class.java)

    /** The field's text as the laptop has it. */
    private var sent = ""

    /** A new link was asked for. */
    private var restarting = false

    /** Open batch edits: the keyboard hears of the cursor once the last one ends. */
    private var batch = 0

    override fun beginBatchEdit(): Boolean {
        batch++
        return true
    }

    override fun endBatchEdit(): Boolean {
        if (batch > 0) batch--
        if (batch == 0) report()
        return batch > 0
    }

    override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
        super.setComposingText(text, newCursorPosition)
        changed()
        return true
    }

    override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
        super.commitText(text, newCursorPosition)
        changed()
        return true
    }

    override fun finishComposingText(): Boolean {
        super.finishComposingText()
        changed()
        return true
    }

    override fun setComposingRegion(start: Int, end: Int): Boolean {
        super.setComposingRegion(start, end)
        changed()
        return true
    }

    override fun setSelection(start: Int, end: Int): Boolean {
        super.setSelection(start, end)
        changed()
        return true
    }

    /**
     * A Backspace with a word in the field. Asked to delete more than the field holds before the
     * cursor, the rest is laptop text from before the field: it gets a Backspace each.
     */
    override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        val held = editable?.let { Selection.getSelectionStart(it) }?.coerceAtLeast(0) ?: 0
        super.deleteSurroundingText(beforeLength, afterLength)
        changed()
        repeat((beforeLength - held).coerceAtLeast(0)) { backspace() }
        return true
    }

    /** As [deleteSurroundingText], counted in characters rather than UTF-16 units. */
    override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean {
        val held = editable?.let { field ->
            Character.codePointCount(field, 0, Selection.getSelectionStart(field).coerceAtLeast(0))
        } ?: 0
        super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
        changed()
        repeat((beforeLength - held).coerceAtLeast(0)) { backspace() }
        return true
    }

    /**
     * A key the keyboard sends as a key, such as Enter: the view sends it, and the field is out of
     * step. Backspace on an empty field is not: it deletes laptop text from before the field.
     */
    override fun sendKeyEvent(event: KeyEvent): Boolean {
        val sentOn = super.sendKeyEvent(event)
        val key = event.keyCode
        val emptyBackspace = key == KeyEvent.KEYCODE_DEL && editable.isNullOrEmpty()
        val down = event.action == KeyEvent.ACTION_DOWN
        if (down && !KeyEvent.isModifierKey(key) && !emptyBackspace) startAgain()
        return sentOn
    }

    /** The keyboard's action key, where it shows one instead of Enter. */
    override fun performEditorAction(actionCode: Int): Boolean {
        view.handleKeyCode(KeyEvent.KEYCODE_ENTER, 0)
        startAgain()
        return true
    }

    private fun changed() {
        val field = editable ?: return
        sync(field)
        if (batch == 0) report()
    }

    /** Sends what changed in the field since the last call. */
    private fun sync(field: Editable) {
        val now = field.toString()
        // Kotlin's common prefix never ends between the two halves of a character.
        val common = sent.commonPrefixWith(now).length
        repeat(sent.codePointCount(common, sent.length)) { backspace() }
        val added = now.substring(common)
        sent = now
        if (added.isEmpty()) return
        view.stopTextSelectionMode()
        // Read before typing: the first character typed uses the Ctrl up.
        var outOfStep = ctrlArmed()
        var i = 0
        while (i < added.length) {
            val codePoint = added.codePointAt(i)
            i += Character.charCount(codePoint)
            if (codePoint == '\n'.code) {
                view.handleKeyCode(KeyEvent.KEYCODE_ENTER, 0)
                outOfStep = true
            } else {
                view.inputCodePoint(codePoint, false, false)
            }
        }
        val typing = getComposingSpanStart(field) != -1
        if (outOfStep || (now.length > MAX_FIELD && !typing)) startAgain()
    }

    /** Tells the keyboard where the cursor and the word being typed are, as a text field does. */
    private fun report() {
        val field = editable ?: return
        keyboard?.updateSelection(
            view,
            Selection.getSelectionStart(field),
            Selection.getSelectionEnd(field),
            getComposingSpanStart(field),
            getComposingSpanEnd(field)
        )
    }

    private fun backspace() {
        view.handleKeyCode(KeyEvent.KEYCODE_DEL, 0)
    }

    private fun startAgain() {
        if (restarting) return
        restarting = true
        restart()
    }

    companion object {
        /** A text field like Chat's: suggestions and corrections, Enter for a new line. */
        fun describe(outAttrs: EditorInfo) {
            outAttrs.inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_AUTO_CORRECT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE
            outAttrs.imeOptions =
                EditorInfo.IME_FLAG_NO_FULLSCREEN or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            outAttrs.initialSelStart = 0
            outAttrs.initialSelEnd = 0
        }
    }
}
