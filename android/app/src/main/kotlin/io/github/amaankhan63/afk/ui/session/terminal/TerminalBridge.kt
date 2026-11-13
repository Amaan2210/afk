package io.github.amaankhan63.afk.ui.session.terminal

import android.os.Looper
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.sessions.PtyFrame
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** How long the view's grid has to hold still before it is sent. */
private const val RESIZE_DEBOUNCE_MS = 150L

/**
 * Feeds [session] from session [sessionId]'s terminal on the daemon, and sends back what is typed
 * into it and the grid it is shown at.
 *
 * [scope] must run on the main thread, as Termux's emulator and TerminalView do; create the bridge
 * on it too.
 */
class TerminalBridge(
    private val repo: SessionsRepository,
    private val sessionId: String,
    private val scope: CoroutineScope,
    private val debounceMs: Long = RESIZE_DEBOUNCE_MS
) {
    /** Redraws the view showing [session]; [TerminalHost] sets it while it shows one. */
    var onScreenChanged: (() -> Unit)? = null

    /**
     * Gives the keyboard a new, empty field on the view showing [session], so a word it was
     * suggesting for is not continued after the key bar moved the laptop's cursor; [TerminalHost]
     * sets it while it shows one.
     */
    var resetKeyboard: (() -> Unit)? = null

    /** Called after a snapshot replaced the screen; [TerminalHost] ends a text selection there. */
    var onSnapshot: (() -> Unit)? = null

    /**
     * Focuses the view showing [session] and opens the soft keyboard on it, or closes the keyboard
     * when that view has it; [TerminalHost] sets it while it shows one. The key bar's keyboard key
     * calls it.
     */
    var toggleKeyboard: (() -> Unit)? = null

    val session = AfkTerminalSession(
        client = ScreenClient(),
        onInput = { repo.ptyInput(sessionId, it) },
        onResize = ::onSizeChanged
    )

    private val mutableFailure = MutableStateFlow<AfkError?>(null)

    /** Why the daemon refused the terminal or stopped answering for it; cleared by [attach]. */
    val failure: StateFlow<AfkError?> = mutableFailure.asStateFlow()

    private var frames: Job? = null
    private var pendingResize: Job? = null

    /** The grid the view last laid out; null until it has. */
    private var viewGrid: Grid? = null

    private val attached: Boolean get() = frames?.isActive == true

    /**
     * Shows the terminal: subscribes, and through the repository subscribes again after every
     * reconnect, until [detach]. Replaces an earlier [attach]. The subscription asks for the grid
     * the view last laid out, or for [cols] × [rows] until the view has laid out.
     */
    fun attach(cols: Int, rows: Int) {
        checkMainThread()
        frames?.cancel()
        mutableFailure.value = null
        val grid = viewGrid ?: Grid(cols, rows)
        // The subscription resizes the daemon's pty to this grid, and the emulator must exist
        // before the first frame.
        session.applyRemoteSize(grid.cols, grid.rows)
        frames = scope.launch {
            checkMainThread()
            try {
                repo.pty(sessionId, grid.cols, grid.rows).collect(::show)
            } catch (e: AfkError) {
                mutableFailure.value = e
            }
        }
    }

    /** Stops the terminal's frames and any resize not sent yet. The screen keeps what it shows. */
    fun detach() {
        frames?.cancel()
        frames = null
        pendingResize?.cancel()
        pendingResize = null
    }

    /**
     * The view's grid. While attached, it is sent once it has held still for [debounceMs], so a
     * rotation or the keyboard opening sends one resize. While detached, it is only kept for the
     * next [attach]: the laptop's terminal is not resized for a phone that is not watching.
     */
    fun onSizeChanged(cols: Int, rows: Int) {
        checkMainThread()
        viewGrid = Grid(cols, rows)
        pendingResize?.cancel()
        if (!attached) return
        pendingResize = scope.launch {
            checkMainThread()
            delay(debounceMs)
            repo.ptyResize(sessionId, cols, rows)
            // A snapshot can have sized the emulator to the old grid meanwhile.
            session.applyRemoteSize(cols, rows)
        }
    }

    /**
     * Sends the view's grid again when the terminal has another, as after the laptop resized it
     * while the view was out of sight: a view shown again lays out no new grid to send. Only while
     * attached, and not while a resize of the view's grid is about to go out anyway.
     */
    fun reclaimGrid() {
        checkMainThread()
        val grid = viewGrid ?: return
        val emulator = session.emulator ?: return
        if (!attached || pendingResize?.isActive == true) return
        if (emulator.mColumns == grid.cols && emulator.mRows == grid.rows) return
        repo.ptyResize(sessionId, grid.cols, grid.rows)
        session.applyRemoteSize(grid.cols, grid.rows)
    }

    private fun show(frame: PtyFrame) {
        when (frame) {
            is PtyFrame.Snapshot -> {
                session.reset()
                session.applyRemoteSize(frame.cols, frame.rows)
                session.feed(frame.bytes)
                onSnapshot?.invoke()
            }

            is PtyFrame.Data -> session.feed(frame.bytes)

            is PtyFrame.Resized -> session.applyRemoteSize(frame.cols, frame.rows)
        }
    }

    /**
     * Passes screen changes to [onScreenChanged]. There is no process to finish, and copy and paste
     * never get here: [AfkTerminalSession] handles them. Logs are dropped: the emulator's can quote
     * terminal output.
     */
    private inner class ScreenClient : TerminalSessionClient {
        override fun onTextChanged(changedSession: TerminalSession) {
            onScreenChanged?.invoke()
        }

        override fun onColorsChanged(session: TerminalSession) {
            onScreenChanged?.invoke()
        }

        override fun onTitleChanged(changedSession: TerminalSession) = Unit

        override fun onSessionFinished(finishedSession: TerminalSession) = Unit

        override fun onCopyTextToClipboard(session: TerminalSession, text: String?) = Unit

        override fun onPasteTextFromClipboard(session: TerminalSession) = Unit

        override fun onBell(session: TerminalSession) = Unit

        override fun onTerminalCursorStateChange(state: Boolean) = Unit

        /** Null: Termux's default, a block. */
        override fun getTerminalCursorStyle(): Int? = null

        override fun logError(tag: String?, message: String?) = Unit

        override fun logWarn(tag: String?, message: String?) = Unit

        override fun logInfo(tag: String?, message: String?) = Unit

        override fun logDebug(tag: String?, message: String?) = Unit

        override fun logVerbose(tag: String?, message: String?) = Unit

        override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) = Unit

        override fun logStackTrace(tag: String?, e: Exception?) = Unit
    }
}

private data class Grid(val cols: Int, val rows: Int)

/** Termux's emulator and TerminalView are not thread-safe: a scope off the main thread fails. */
private fun checkMainThread() = check(Looper.myLooper() == Looper.getMainLooper()) {
    "TerminalBridge must run on the main thread"
}
