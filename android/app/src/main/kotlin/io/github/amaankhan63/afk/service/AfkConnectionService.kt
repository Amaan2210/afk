package io.github.amaankhan63.afk.service

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.protocol.Pending
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import io.github.amaankhan63.afk.service.ConnectionNotification.Companion.CONNECTING
import io.github.amaankhan63.afk.service.ConnectionNotification.Companion.FOREGROUND_ID
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the connection to the paired laptop open while the app is in the background, shows which
 * laptop it is connected to, and posts the daemon's `notify` messages as notifications. It
 * connects whenever a pairing is saved and stops itself when the pairing is cleared.
 */
@AndroidEntryPoint
class AfkConnectionService : Service() {
    @Inject lateinit var manager: ConnectionManager

    @Inject lateinit var repo: SessionsRepository

    @Inject lateinit var pairingStore: PairingStore

    @Inject lateinit var settingsStore: AppSettingsStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        NotificationChannels.ensure(this)
        val notifications = ConnectionNotification(this)
        if (!enterForeground(notifications.connectionNotification(CONNECTING))) {
            stopSelf()
            return
        }
        // Read for each notification, so a switch in Settings counts from the next one.
        val notifier = SessionNotifier(this) { settingsStore.settings.value.notifications }
        // Undispatched, so it listens before the connection starts: `notify` is not replayed.
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            repo.notifications.collect { n ->
                notifier.build(n)?.let {
                    val id = NotificationActions.notificationId(n.sessionId)
                    notifications.post(id, it, NotificationActions.notificationTag(n))
                }
            }
        }
        val shown = NotificationManagerCompat.from(this)
        scope.launch { cancelAnsweredPrompts(repo.sessions, shown::cancel) }
        scope.launch { cancelOnScreen(ForegroundTracker.foregroundSessionId, shown::cancel) }
        scope.launch { followPairing(pairingStore.pairingOrNone, manager, ::stopSelf) }
        scope.launch {
            // A pairing that cannot be read leaves a failure to say "the laptop".
            val host = pairingStore.pairing.catch { emit(null) }.map { it?.host }
            combine(manager.state, host, ::connectionStatusText).distinctUntilChanged().collect {
                notifications.post(FOREGROUND_ID, notifications.connectionNotification(it))
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        manager.stop()
        scope.cancel()
        super.onDestroy()
    }

    /** Shows [notification] as the service's own; false when Android refuses the foreground. */
    private fun enterForeground(notification: Notification): Boolean {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else {
            0
        }
        return try {
            ServiceCompat.startForeground(this, FOREGROUND_ID, notification, type)
            true
        } catch (e: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException (API 31+): started from the background.
            Log.w(TAG, "foreground start refused", e)
            false
        } catch (e: SecurityException) {
            // A foreground-service permission or prerequisite missing (API 34+).
            Log.w(TAG, "foreground start refused", e)
            false
        }
    }

    companion object {
        private const val TAG = "AfkConnectionService"

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, AfkConnectionService::class.java)
                )
            } catch (e: IllegalStateException) {
                // ForegroundServiceStartNotAllowedException (API 31+): the app is in the background.
                Log.w(TAG, "connection service not started", e)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AfkConnectionService::class.java))
        }
    }
}

/**
 * Connects [manager] to each pairing [pairings] holds, the latest replacing the one before, and
 * calls [onUnpaired] once there is none: the app was unpaired, or its preferences cannot be read.
 */
internal suspend fun followPairing(
    pairings: Flow<PairingPayload?>,
    manager: ConnectionManager,
    onUnpaired: () -> Unit
) {
    pairings.collect { pairing ->
        manager.stop()
        if (pairing == null) onUnpaired() else manager.start(pairing.endpoint(), pairing.token)
    }
}

/**
 * Cancels, through [cancel], the notification of each session whose prompt [sessions] no longer
 * shows waiting: answered in the app or on the laptop, replaced by another, or gone with its
 * session. Its buttons would only say "Already answered". A sub-agent's notification stays.
 */
internal suspend fun cancelAnsweredPrompts(
    sessions: Flow<List<Session>>,
    cancel: (notificationId: Int) -> Unit
) {
    // The prompt each waiting session shows, by session; null for one sent without details.
    var waiting = emptyMap<String, String?>()
    sessions.collect { list ->
        val now = list
            .filter { it.pending != null || it.state == SessionState.needs_input }
            .associate { it.id to it.pending?.id }
        for ((sessionId, promptId) in waiting) {
            if (sessionId !in now || now[sessionId] != promptId) {
                cancel(NotificationActions.notificationId(sessionId))
            }
        }
        waiting = now
    }
}

/**
 * Cancels, through [cancel], both notifications of a session as its screen comes to the front
 * ([foreground], see [ForegroundTracker]): the user is looking at the session, so a question or an
 * end it was told of is old news, and the Open button of a notification does not remove it by
 * itself. The session's own notification has no tag; the one for its sub-agents has
 * [NotificationActions.SUBAGENT_TAG].
 */
internal suspend fun cancelOnScreen(
    foreground: Flow<String?>,
    cancel: (tag: String?, notificationId: Int) -> Unit
) {
    foreground.filterNotNull().collect { sessionId ->
        val id = NotificationActions.notificationId(sessionId)
        cancel(null, id)
        cancel(NotificationActions.SUBAGENT_TAG, id)
    }
}

private val Pending.id: String
    get() = when (this) {
        is Pending.Question -> id
        is Pending.Permission -> id
    }
