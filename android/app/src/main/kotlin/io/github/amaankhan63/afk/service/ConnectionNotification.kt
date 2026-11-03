package io.github.amaankhan63.afk.service

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.PendingIntentCompat
import androidx.core.content.ContextCompat
import io.github.amaankhan63.afk.MainActivity
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.failureText

private const val TAG = "ConnectionNotification"

/**
 * The connection service's notifications: its own ongoing one, which says which laptop it is
 * connected to, and [post], which shows any notification the user allows.
 */
class ConnectionNotification(private val context: Context) {
    /** The ongoing notification that reads [text]; a tap opens the app. */
    fun connectionNotification(text: String): Notification =
        NotificationCompat.Builder(context, NotificationChannels.CONNECTION)
            .setSmallIcon(SessionNotifier.SMALL_ICON)
            .setContentTitle("AFK")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openApp())
            .build()

    private fun openApp(): PendingIntent? = PendingIntentCompat.getActivity(
        context,
        0,
        AfkConnectionService.openAppIntent(context),
        0,
        false
    )

    /** Shows [notification] when the user allows notifications; never throws. */
    fun post(id: Int, notification: Notification) {
        val notifications = NotificationManagerCompat.from(context)
        if (!notifications.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
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
        /** Negative, so it never meets a session's [NotificationActions.notificationId]. */
        internal const val FOREGROUND_ID = -1

        /** What the connection notification says before the connection's state is known. */
        internal const val CONNECTING = "Connecting…"
    }
}

/**
 * Opens the app from the connection notification. A running app is brought forward with its
 * screens as they are; a plain intent would start a second activity on top of it.
 */
internal fun AfkConnectionService.Companion.openAppIntent(context: Context): Intent =
    Intent(context, MainActivity::class.java).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP
    )

/**
 * The connection notification's text in [state], [host] being the paired address. While the
 * service runs a pairing exists, so a disconnected manager is about to connect: it reads
 * "Connecting…" rather than flashing "Disconnected" at start-up and on a new pairing. A failure
 * reads as the sessions screen's banner says it.
 */
internal fun connectionStatusText(state: ConnectionState, host: String?): String = when (state) {
    is ConnectionState.Connected -> "Connected to ${state.hello.daemon.hostname}"
    is ConnectionState.Connecting, ConnectionState.Disconnected -> ConnectionNotification.CONNECTING
    is ConnectionState.Failed -> failureText(state.code, host)
}
