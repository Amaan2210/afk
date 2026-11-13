package io.github.amaankhan63.afk.ui.settings

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DaemonSettingsPatch
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.sessions.ERROR_TIMEOUT
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.data.settings.AppSettings
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import io.github.amaankhan63.afk.data.settings.MAX_TERMINAL_FONT_SP
import io.github.amaankhan63.afk.data.settings.MIN_TERMINAL_FONT_SP
import io.github.amaankhan63.afk.data.settings.NotificationPrefs
import io.github.amaankhan63.afk.service.AfkConnectionService
import io.github.amaankhan63.afk.ui.session.StripChip
import io.github.amaankhan63.afk.ui.session.asAfkError
import io.github.amaankhan63.afk.ui.theme.AfkThemeId
import io.github.amaankhan63.afk.ui.theme.ThemeMode
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The Settings screen: the app's settings, which it saves as they change, and the paired laptop,
 * whose keep-awake it switches, which it names and which it unpairs. Failures go to [errors].
 */
@HiltViewModel
class SettingsViewModel internal constructor(
    private val store: AppSettingsStore,
    private val repo: SessionsRepository,
    private val pairingStore: PairingStore,
    // The application's context: it outlives the view model.
    private val context: Context,
    private val stopService: (Context) -> Unit
) : ViewModel() {
    @Inject constructor(
        store: AppSettingsStore,
        repo: SessionsRepository,
        pairingStore: PairingStore,
        @ApplicationContext context: Context
    ) : this(store, repo, pairingStore, context, AfkConnectionService.Companion::stop)

    private val version = versionOf(context)
    private val keepAwakeBusy = MutableStateFlow(false)

    // Buffered for the one screen that collects them, also across a rotation and while it shows
    // an earlier one.
    private val errorEvents = Channel<AfkError>(Channel.BUFFERED)

    /**
     * Settings that could not be saved, keep-awake changes the daemon refused, a failed unpair;
     * each shown once.
     */
    val errors: Flow<AfkError> = errorEvents.receiveAsFlow()

    private val unpairedEvents = Channel<Unit>(Channel.BUFFERED)

    /** The laptop was forgotten and the connection service stopped: the screen leaves. */
    val unpaired: Flow<Unit> = unpairedEvents.receiveAsFlow()

    private val mutableFontSaveFailures = MutableStateFlow(0)

    /** Font sizes that could not be saved, counted; the slider drops a size it did not save. */
    val fontSaveFailures: StateFlow<Int> = mutableFontSaveFailures.asStateFlow()

    // Unpairing lasts past a success: the screen is leaving.
    private var unpairing = false

    val ui: StateFlow<SettingsUiState> = combine(
        store.settings,
        repo.connection,
        combine(repo.daemonSettings, repo.stats, ::Pair),
        // A pairing that cannot be read leaves the address to the connection.
        pairingStore.pairing.catch { emit(null) },
        keepAwakeBusy
    ) { settings, connection, (daemon, stats), pairing, busy ->
        uiState(settings, connection, daemon, stats, pairing, busy)
    }.stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        uiState(
            store.settings.value,
            repo.connection.value,
            repo.daemonSettings.value,
            repo.stats.value,
            null,
            false
        )
    )

    fun setTheme(id: AfkThemeId) = save { it.copy(theme = id) }

    fun setMode(mode: ThemeMode) = save { it.copy(mode = mode) }

    fun setAlwaysDark(on: Boolean) = save { it.copy(alwaysDarkTerminal = on) }

    /** Shows or hides [chip] on the status strip, which keeps the order of [StripChip]. */
    fun setChip(chip: StripChip, shown: Boolean) = save { settings ->
        val picked = settings.stripChips
        val chips = StripChip.entries.filter { if (it == chip) shown else it in picked }
        settings.copy(stripChips = chips)
    }

    /** Applies [change] to the notification switches as saved. */
    fun setNotif(change: (NotificationPrefs) -> NotificationPrefs) =
        save { it.copy(notifications = change(it.notifications)) }

    fun setFontSize(sp: Int) = save(onFailure = { mutableFontSaveFailures.update { it + 1 } }) {
        it.copy(terminalFontSp = sp.coerceIn(MIN_TERMINAL_FONT_SP, MAX_TERMINAL_FONT_SP))
    }

    fun setKeyBar(on: Boolean) = save { it.copy(keyBar = on) }

    fun setSwipeTabs(on: Boolean) = save { it.copy(swipeTabs = on) }

    fun setWordSuggestions(on: Boolean) = save { it.copy(wordSuggestions = on) }

    /**
     * Names the laptop, as the app shows it from then on; a blank [name] gives it the computer's
     * own name back.
     */
    fun setLaptopName(name: String) {
        viewModelScope.launch {
            repo.setDaemonSettings(DaemonSettingsPatch(laptopName = name.trim()))
                .onFailure { errorEvents.trySend(it.shown()) }
        }
    }

    /**
     * Asks the daemon to keep the laptop awake while agents work, or not. Ignored while an earlier
     * change waits for its reply; the switch shows the daemon's answer.
     */
    fun setKeepAwake(on: Boolean) {
        if (!keepAwakeBusy.compareAndSet(expect = false, update = true)) return
        viewModelScope.launch {
            repo.setDaemonSettings(DaemonSettingsPatch(keepAwake = on))
                .onFailure { errorEvents.trySend(it.shown()) }
            keepAwakeBusy.value = false
        }
    }

    /**
     * Unpairs. While connected, the laptop is first told to unpair this phone, end every session
     * and stop AFK; if that fails nothing changes, so it can be tried again. Then, and at once
     * while not connected, the app forgets the laptop: clears the pairing, stops the connection
     * service and sends [unpaired]. Ignored while an unpair is under way.
     */
    fun unpair() {
        if (unpairing) return
        unpairing = true
        viewModelScope.launch {
            if (repo.connection.value is ConnectionState.Connected) {
                val failure = repo.stopDaemon().exceptionOrNull()
                if (failure != null) {
                    unpairing = false
                    val why = failure.shown().message
                    errorEvents.trySend(AfkError(ERROR_NOT_STOPPED, "$NOT_STOPPED: $why"))
                    return@launch
                }
            }
            try {
                pairingStore.clear()
            } catch (e: IOException) {
                unpairing = false
                errorEvents.trySend(AfkError(ERROR_NOT_SAVED, NOT_UNPAIRED))
                return@launch
            }
            stopService(context)
            unpairedEvents.trySend(Unit)
        }
    }

    /**
     * Saves [transform] of the settings as saved, so changes made in quick succession all hold.
     * When they cannot be saved, [onFailure] runs and then the failure is reported.
     */
    private fun save(onFailure: () -> Unit = {}, transform: (AppSettings) -> AppSettings) {
        viewModelScope.launch {
            try {
                store.update(transform)
            } catch (e: IOException) {
                onFailure()
                errorEvents.trySend(AfkError(ERROR_NOT_SAVED, NOT_SAVED))
            }
        }
    }

    private fun uiState(
        settings: AppSettings,
        connection: ConnectionState,
        daemon: DaemonSettings?,
        stats: Stats?,
        pairing: PairingPayload?,
        busy: Boolean
    ): SettingsUiState {
        val laptop = (connection as? ConnectionState.Connected)?.hello?.daemon
        return SettingsUiState(
            settings = settings,
            hostname = laptop?.let { daemon?.laptopName ?: it.hostname },
            laptopName = daemon?.laptopName,
            address = laptop?.tailscaleIp ?: pairing?.let { "${it.host}:${it.port}" },
            connected = laptop != null,
            keepAwake = daemon?.keepAwake,
            keepAwakeBusy = busy,
            keepAwakeActive = stats?.keepAwakeActive.takeIf { laptop != null },
            graceMin = daemon?.keepAwakeGraceMin ?: DEFAULT_GRACE_MIN,
            version = version
        )
    }

    private companion object {
        const val ERROR_NOT_SAVED = "not_saved"
        const val NOT_SAVED = "The setting could not be saved"
        const val NOT_UNPAIRED = "Could not unpair; try again"
        const val ERROR_NOT_STOPPED = "not_stopped"
        const val NOT_STOPPED = "Not unpaired, the laptop did not stop AFK"
        const val NOT_CONNECTED = "Not connected"

        /** A request the daemon did not get or did not answer is "Not connected". */
        fun Throwable.shown(): AfkError {
            val error = asAfkError(answering = false)
            val unreached = error.code == ERROR_DISCONNECTED || error.code == ERROR_TIMEOUT
            return if (unreached) AfkError(error.code, NOT_CONNECTED) else error
        }

        fun versionOf(context: Context): String {
            val packages = context.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packages.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packages.getPackageInfo(context.packageName, 0)
            }
            return info.versionName ?: "?"
        }
    }
}
