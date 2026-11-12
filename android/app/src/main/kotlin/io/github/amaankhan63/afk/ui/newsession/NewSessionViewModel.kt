package io.github.amaankhan63.afk.ui.newsession

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.sessions.ERROR_TIMEOUT
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.ui.session.asAfkError
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The new-session form, the laptop's folders its picker browses, and the start of the session.
 * Failures go to [NewSessionUiState.error].
 */
@HiltViewModel
class NewSessionViewModel @Inject constructor(private val repo: SessionsRepository) : ViewModel() {
    private val state = MutableStateFlow(NewSessionUiState())

    val ui: StateFlow<NewSessionUiState> = state.asStateFlow()

    // Buffered for the screen, also across a rotation.
    private val createdIds = Channel<String>(Channel.BUFFERED)

    /** The id of the session [start] created, for the screen to open. */
    val created: Flow<String> = createdIds.receiveAsFlow()

    // The latest listing asked for: a newer one replaces it, so an older reply cannot land last.
    private var listing: Job? = null

    /**
     * Lists the folders in [path], the drives for null. A failure keeps the listing shown, so the
     * picker stays where it was.
     */
    fun browse(path: String?) {
        listing?.cancel()
        state.update { it.copy(browsing = true) }
        listing = viewModelScope.launch {
            repo.listDirs(path)
                .onSuccess { dirs ->
                    state.update { it.copy(browse = dirs, recent = dirs.recent, browsing = false) }
                }
                .onFailure { e ->
                    state.update { it.copy(error = e.shownMessage(), browsing = false) }
                }
        }
    }

    /** Chooses folder [path] and closes the listing; the daemon checks the folder on start. */
    fun pick(path: String) {
        listing?.cancel()
        state.update { it.copy(cwd = path.trim(), browse = null, browsing = false) }
    }

    /** Another agent starts from its own default chips; the model and prompt stay. */
    fun setKind(k: SessionKind) {
        state.update { if (it.kind == k) it else it.copy(kind = k, flags = defaultFlags(k)) }
    }

    fun toggleFlag(id: String) {
        state.update { it.copy(flags = if (id in it.flags) it.flags - id else it.flags + id) }
    }

    fun setName(n: String) {
        state.update { it.copy(name = n) }
    }

    fun setModel(m: String) {
        state.update { it.copy(model = m) }
    }

    fun setPrompt(p: String) {
        state.update { it.copy(prompt = p) }
    }

    fun clearError() {
        state.update { it.copy(error = null) }
    }

    /**
     * Starts the session; its id goes to [created]. Does nothing until a folder is chosen or while
     * a start is under way. A blank prompt is none, and a blank name leaves the daemon to name
     * the session after its folder.
     */
    fun start() {
        val form = state.value
        if (!form.canStart) return
        state.update { it.copy(starting = true) }
        // A shell takes neither arguments nor a prompt: the daemon refuses them.
        val shell = form.kind == SessionKind.shell
        val args = if (shell) emptyList() else LaunchFlags.args(form.kind, form.flags, form.model)
        val prompt = if (shell) null else form.prompt.ifBlank { null }
        val name = form.name.trim().ifBlank { null }
        viewModelScope.launch {
            repo.createSession(form.cwd, form.kind, args, name = name, prompt = prompt)
                .onSuccess { createdIds.send(it) }
                .onFailure { e ->
                    val message = e.shownMessage(creating = true)
                    state.update { it.copy(error = message) }
                }
            state.update { it.copy(starting = false) }
        }
    }

    private companion object {
        const val NOT_CONNECTED = "Not connected"
        const val NO_ANSWER = "The laptop did not answer; try again"
        const val NO_REPLY = "No reply — the session may have started; check the list"

        fun defaultFlags(kind: SessionKind): Set<String> = when (kind) {
            SessionKind.claude -> setOf("skip")
            SessionKind.codex -> setOf("yolo")
            SessionKind.shell -> emptySet()
        }

        /**
         * A failure in the screen's words. The daemon's own messages, such as why it refuses a
         * folder, are already readable; a request it did not get is "Not connected", and one
         * it did not answer says so. The daemon creates a session even when its reply is lost, so
         * an unanswered create ([creating]) says to check the list before starting it again.
         */
        fun Throwable.shownMessage(creating: Boolean = false): String {
            val error = asAfkError(answering = false)
            return when {
                creating && error.code == ERROR_TIMEOUT -> NO_REPLY
                error.code == ERROR_TIMEOUT -> NO_ANSWER
                error.code == ERROR_DISCONNECTED -> NOT_CONNECTED
                else -> error.message ?: error.code
            }
        }
    }
}
