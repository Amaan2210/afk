package io.github.amaankhan63.afk.service

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.pairing.PairingStore
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
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
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
                    notifications.post(NotificationActions.notificationId(n.sessionId), it)
                }
            }
        }
        scope.launch {
            pairingStore.pairing.collect { pairing ->
                manager.stop()
                if (pairing == null) {
                    stopSelf()
                } else {
                    manager.start(pairing.endpoint(), pairing.token)
                }
            }
        }
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
