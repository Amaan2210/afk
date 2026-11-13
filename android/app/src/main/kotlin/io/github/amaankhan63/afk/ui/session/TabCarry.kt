package io.github.amaankhan63.afk.ui.session

import android.os.SystemClock
import io.github.amaankhan63.afk.ui.session.terminal.ClaudeInput
import io.github.amaankhan63.afk.ui.session.terminal.TerminalBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** How long after the last key the screen is read: its echo has to come back first. */
internal const val CARRY_SETTLE_MS = 600L

/** How often the screen is read while waiting for Claude to erase the text. */
internal const val CARRY_POLL_MS = 100L

/** How long Claude has to erase the text before it counts as not erased. */
internal const val CARRY_ERASE_TIMEOUT_MS = 3_000L

/** A screen unchanged this long after a change is done changing. */
internal const val CARRY_STABLE_MS = 300L

/** At most this many reads of a long text, each erasing the rows on the screen. */
private const val MAX_PASSES = 20

/** Longer than this, Claude would show a text from Chat as `[Pasted text #1]`. */
internal const val MAX_CARRIED_CHARS = 700

/** More lines than this, Claude would show a text from Chat as `[Pasted text #1 +3 lines]`. */
internal const val MAX_CARRIED_LINES = 3

private const val BACKSPACE: Byte = 0x7f
private const val PASTE_START = "\u001b[200~"
private const val PASTE_END = "\u001b[201~"

/** Escape and the C1 controls, which would end the paste early or start a sequence. */
private val NOT_PASTED = Regex("[\u001b\u0080-\u009f]")

/**
 * Moves unsent text between Claude Code's input box and the Chat box when the tab changes, so
 * it is typed in one place only and is never sent twice.
 *
 * [toChat] reads the input box off [bridge]'s screen, erases it on the laptop with Backspaces,
 * and once the screen shows it erased adds it to the Chat box, after what that holds. A long text
 * shows only its last rows: each read takes those, and the next one the rows before.
 * [toTerminal] pastes the Chat box into an empty input box, without Enter, and empties the Chat
 * box. Either does nothing unless [canType] (connected, a Claude session, no prompt waiting) and
 * the screen shows Claude's input box with the cursor after its text.
 */
internal class TabCarry(
    private val bridge: TerminalBridge,
    private val scope: CoroutineScope,
    private val canType: () -> Boolean,
    private val type: (ByteArray) -> Unit,
    private val composer: () -> String,
    private val setComposer: (String) -> Unit,
    private val now: () -> Long = SystemClock::uptimeMillis
) {
    private var moving: Job? = null

    fun toChat() {
        moving?.cancel()
        moving = scope.launch {
            // Letters typed a moment ago may not be on the screen yet.
            delay((bridge.lastInputAt + CARRY_SETTLE_MS - now()).coerceIn(0, CARRY_SETTLE_MS))
            var moved = ""
            try {
                var box = bridge.claudeInput()
                var passes = 0
                while (box is ClaudeInput.Typed && passes++ < MAX_PASSES && canType()) {
                    // Counted as moved from here on: once the Backspaces are out, a cancel must
                    // not drop the text.
                    moved = box.text + moved
                    type(ByteArray(box.backspaces) { BACKSPACE })
                    val next = erased(box)
                    if (next == null) {
                        // Never erased: it stays on the laptop only.
                        moved = moved.removePrefix(box.text)
                        break
                    }
                    box = next.input
                }
            } finally {
                if (moved.isNotEmpty()) setComposer(appended(composer(), moved))
            }
        }
    }

    fun toTerminal() {
        moving?.cancel()
        val text = composer()
        if (text.isBlank() || !canType()) return
        if (text.length > MAX_CARRIED_CHARS || text.lines().size > MAX_CARRIED_LINES) return
        if (bridge.claudeInput() != ClaudeInput.Empty) return
        val pasted = text.replace("\r\n", "\n").replace(NOT_PASTED, "")
        type((PASTE_START + pasted + PASTE_END).toByteArray(Charsets.UTF_8))
        setComposer("")
    }

    /**
     * The screen once it settled on something other than [before]; null if it never did. A
     * redraw that shows [before] again, as after a moment with the cursor hidden, is no change:
     * the Backspaces may not have arrived yet.
     */
    private suspend fun erased(before: ClaudeInput): Read? {
        var waited = 0L
        var seen: ClaudeInput? = before
        var steadyFor = 0L
        while (waited < CARRY_ERASE_TIMEOUT_MS) {
            delay(CARRY_POLL_MS)
            waited += CARRY_POLL_MS
            val read = bridge.claudeInput()
            if (read != seen) {
                seen = read
                steadyFor = 0
            } else if (read != before) {
                steadyFor += CARRY_POLL_MS
                if (steadyFor >= CARRY_STABLE_MS) return Read(read)
            }
        }
        return if (seen != before) Read(seen) else null
    }

    /** One read of the screen; [input] is null when it no longer shows the input box. */
    private class Read(val input: ClaudeInput?)
}

/** [moved] after [existing], a space between them unless [existing] ends in one. */
private fun appended(existing: String, moved: String): String = when {
    existing.isEmpty() -> moved
    existing.last().isWhitespace() -> existing + moved
    else -> "$existing $moved"
}
