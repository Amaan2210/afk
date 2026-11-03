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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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

    // The latest listing asked for: a newer one replaces it, so an older reply cannot land last.
    private var browsing: Job? = null

    /**
     * Lists the folders in [path], the drives for null. A failure keeps the listing shown, so the
     * picker stays where it was.
     */
    fun browse(path: String?) {
        browsing?.cancel()
        browsing = viewModelScope.launch {
            repo.listDirs(path)
                .onSuccess { dirs -> state.update { it.copy(browse = dirs, recent = dirs.recent) } }
                .onFailure { e -> state.update { it.copy(error = e.shownMessage()) } }
        }
    }

    /** Chooses folder [path] and closes the listing; the daemon checks the folder on start. */
    fun pick(path: String) {
        browsing?.cancel()
        state.update { it.copy(cwd = path.trim(), browse = null) }
    }

    /** Another agent starts from its own default chips; the model and prompt stay. */
    fun setKind(k: SessionKind) {
        state.update { if (it.kind == k) it else it.copy(kind = k, flags = defaultFlags(k)) }
    }

    fun toggleFlag(id: String) {
        state.update { it.copy(flags = if (id in it.flags) it.flags - id else it.flags + id) }
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
     * Starts the session and hands its id to [onCreated]. Does nothing until a folder is chosen or
     * while a start is under way, which lasts past a success: the screen is leaving. A blank
     * prompt is none.
     */
    fun start(onCreated: (String) -> Unit) {
        val form = state.value
        if (!form.canStart) return
        state.update { it.copy(starting = true) }
        // A shell takes neither arguments nor a prompt: the daemon refuses them.
        val shell = form.kind == SessionKind.shell
        val args = if (shell) emptyList() else LaunchFlags.args(form.kind, form.flags, form.model)
        val prompt = if (shell) null else form.prompt.ifBlank { null }
        viewModelScope.launch {
            repo.createSession(form.cwd, form.kind, args, name = null, prompt = prompt)
                .onSuccess(onCreated)
                .onFailure { e ->
                    state.update { it.copy(starting = false, error = e.shownMessage()) }
                }
        }
    }

    private companion object {
        const val NOT_CONNECTED = "Not connected"

        fun defaultFlags(kind: SessionKind): Set<String> =
            if (kind == SessionKind.claude) setOf("skip") else emptySet()

        /**
         * A failure in the screen's words. The daemon's own messages, such as why it refuses a
         * folder, are already readable; a request it did not get or did not answer is
         * "Not connected".
         */
        fun Throwable.shownMessage(): String {
            val error = asAfkError(answering = false)
            return when (error.code) {
                ERROR_DISCONNECTED, ERROR_TIMEOUT -> NOT_CONNECTED
                else -> error.message ?: error.code
            }
        }
    }
}
