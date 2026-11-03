package io.github.amaankhan63.afk.service

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.PendingIntentCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import io.github.amaankhan63.afk.MainActivity
import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.failureText
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
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
        if (!enterForeground()) {
            stopSelf()
            return
        }
        // Read for each notification, so a switch in Settings counts from the next one.
        val notifier = SessionNotifier(this) { settingsStore.settings.value.notifications }
        // Undispatched, so it listens before the connection starts: `notify` is not replayed.
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            repo.notifications.collect { n ->
                notifier.build(n)?.let { post(NotificationActions.notificationId(n.sessionId), it) }
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
                post(FOREGROUND_ID, connectionNotification(it))
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

    /** False when Android refuses to run the service in the foreground. */
    private fun enterForeground(): Boolean {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else {
            0
        }
        return try {
            ServiceCompat.startForeground(
                this,
                FOREGROUND_ID,
                connectionNotification(CONNECTING),
                type
            )
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

    private fun connectionNotification(text: String): Notification =
        NotificationCompat.Builder(this, NotificationChannels.CONNECTION)
            .setSmallIcon(SessionNotifier.SMALL_ICON)
            .setContentTitle("AFK")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openApp())
            .build()

    private fun openApp(): PendingIntent? = PendingIntentCompat.getActivity(
        this,
        0,
        openAppIntent(this),
        0,
        false
    )

    /** Shows [notification] when the user allows notifications; never throws. */
    private fun post(id: Int, notification: Notification) {
        val notifications = NotificationManagerCompat.from(this)
        if (!notifications.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        try {
            notifications.notify(id, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "notification refused", e)
        }
    }

    companion object {
        private const val TAG = "AfkConnectionService"

        /** Negative, so it never meets a session's [NotificationActions.notificationId]. */
        private const val FOREGROUND_ID = -1

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

        /**
         * Opens the app from the connection notification. A running app is brought forward with
         * its screens as they are; a plain intent would start a second activity on top of it.
         */
        internal fun openAppIntent(context: Context): Intent =
            Intent(context, MainActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
    }
}

private const val CONNECTING = "Connecting…"

/**
 * The connection notification's text in [state], [host] being the paired address. While the
 * service runs a pairing exists, so a disconnected manager is about to connect: it reads
 * "Connecting…" rather than flashing "Disconnected" at start-up and on a new pairing. A failure
 * reads as the sessions screen's banner says it.
 */
internal fun connectionStatusText(state: ConnectionState, host: String?): String = when (state) {
    is ConnectionState.Connected -> "Connected to ${state.hello.daemon.hostname}"
    is ConnectionState.Connecting, ConnectionState.Disconnected -> CONNECTING
    is ConnectionState.Failed -> failureText(state.code, host)
}
