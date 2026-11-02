package io.github.amaankhan63.afk.ui.session.terminal

import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient

/** Rows of scrollback the emulator keeps. */
private const val TRANSCRIPT_ROWS = 2000

/** The smallest grid Termux's emulator accepts; the daemon allows 1 × 1. */
private const val MIN_GRID = 2

/**
 * Leaves the alternate screen, then resets the terminal (RIS), which also clears the screen and
 * the scrollback. Termux's `TerminalEmulator.reset()` keeps both, and stays on the alternate screen.
 */
private val FULL_RESET = "\u001b[?1049l\u001bc".toByteArray()

/**
 * A Termux session with no local process: the daemon's pty plays it. Output arrives through
 * [feed]; what the view or the emulator writes to the process (keys, answers to terminal queries)
 * goes to [onInput]; the grid the view lays out goes to [onResize].
 *
 * Main thread only, like the emulator and TerminalView, and it must be created on a thread with a
 * Looper: Termux's session makes a Handler. The superclass is given a shell that is never started.
 */
class AfkTerminalSession(
    private val client: TerminalSessionClient,
    private val onInput: (ByteArray) -> Unit,
    private val onResize: (cols: Int, rows: Int) -> Unit
) : TerminalSession("/bin/sh", "/", emptyArray(), emptyArray(), TRANSCRIPT_ROWS, client) {
    // TerminalView passes its cell size on every layout; until then the emulator gets 0 × 0, which
    // only matters to the rare programs that ask for the window's size in pixels.
    private var cellWidthPx = 0
    private var cellHeightPx = 0

    @Volatile private var finished = false

    // True while the emulator reads daemon output, to tell a program's copy request from the user's.
    private var feeding = false

    /** Puts text the user selected and copied on the clipboard; TerminalHost sets it. */
    var onCopyText: ((String) -> Unit)? = null

    /** The clipboard's text, for a paste the user asked for; TerminalHost sets it. */
    var onPasteRequest: (() -> String?)? = null

    override fun initializeEmulator(
        columns: Int,
        rows: Int,
        cellWidthPixels: Int,
        cellHeightPixels: Int
    ) {
        mEmulator = TerminalEmulator(
            this,
            columns,
            rows,
            cellWidthPixels,
            cellHeightPixels,
            TRANSCRIPT_ROWS,
            client
        )
    }

    /** Null until the first grid: [updateSize] from the view, or [applyRemoteSize]. */
    override fun getEmulator(): TerminalEmulator? = mEmulator

    /** Copied: Termux reuses its buffers, for code points among others. */
    override fun write(data: ByteArray, offset: Int, count: Int) {
        if (count > 0) onInput(data.copyOfRange(offset, offset + count))
    }

    /** The view's grid: resizes the emulator at once and reports the grid to [onResize]. */
    override fun updateSize(columns: Int, rows: Int, cellWidthPixels: Int, cellHeightPixels: Int) {
        cellWidthPx = cellWidthPixels
        cellHeightPx = cellHeightPixels
        resizeEmulator(columns, rows)
        onResize(columns, rows)
    }

    /**
     * Sizes the emulator to the daemon's grid, creating it if the view has not laid out yet.
     * Unlike [updateSize], it does not report the grid back: the daemon has it already.
     */
    fun applyRemoteSize(cols: Int, rows: Int) {
        resizeEmulator(cols, rows)
        notifyScreenUpdate()
    }

    private fun resizeEmulator(cols: Int, rows: Int) {
        val columns = cols.coerceAtLeast(MIN_GRID)
        val lines = rows.coerceAtLeast(MIN_GRID)
        // TerminalView keeps the emulator it first gets, so it is resized, never replaced.
        val emulator: TerminalEmulator? = mEmulator
        if (emulator == null) {
            initializeEmulator(columns, lines, cellWidthPx, cellHeightPx)
        } else {
            emulator.resize(columns, lines, cellWidthPx, cellHeightPx)
        }
    }

    /** True until [finish]. */
    override fun isRunning(): Boolean = !finished

    /** Marks the session over, as when its daemon session has ended. */
    fun finish() {
        finished = true
    }

    /** No process to kill. Termux's version signals its shell's pid, which here is 0. */
    override fun finishIfRunning() = Unit

    /** Shows [bytes] of the daemon's output; dropped before the emulator has a grid. */
    fun feed(bytes: ByteArray) {
        val emulator: TerminalEmulator = mEmulator ?: return
        feeding = true
        try {
            emulator.append(bytes, bytes.size)
        } finally {
            feeding = false
        }
        notifyScreenUpdate()
    }

    /** Clears the screen and the scrollback and resets the terminal's modes, for a snapshot. */
    override fun reset() = feed(FULL_RESET)

    /**
     * Copy from TerminalView's selection menu goes to [onCopyText]. A program's request to set the
     * clipboard (OSC 52) arrives while its output is fed, and is ignored.
     */
    override fun onCopyTextToClipboard(text: String?) {
        if (feeding || text == null) return
        onCopyText?.invoke(text)
    }

    /** Paste from TerminalView's selection menu: types the clipboard, bracketed if the program asked. */
    override fun onPasteTextFromClipboard() {
        val text = onPasteRequest?.invoke()
        if (!text.isNullOrEmpty()) mEmulator?.paste(text)
    }
}
