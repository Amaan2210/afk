package io.github.amaankhan63.afk.service

import android.content.Context
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.NotificationManagerCompat.IMPORTANCE_DEFAULT
import androidx.core.app.NotificationManagerCompat.IMPORTANCE_HIGH
import androidx.core.app.NotificationManagerCompat.IMPORTANCE_LOW

/** The app's notification channels, one per kind of event plus the connection's own. */
object NotificationChannels {
    const val NEEDS_INPUT = "needs_input"
    const val FINISHED = "finished"
    const val SUBAGENTS = "subagents"
    const val CONNECTION = "connection"

    /**
     * Creates the channels. Safe to call again: Android keeps an existing channel's importance and
     * sound, which belong to the user once the channel exists.
     */
    fun ensure(context: Context) {
        val channels = listOf(
            NotificationChannelCompat.Builder(NEEDS_INPUT, IMPORTANCE_HIGH)
                .setName("Needs your input")
                .setDescription("An agent asks a question or for permission")
                .build(),
            NotificationChannelCompat.Builder(FINISHED, IMPORTANCE_DEFAULT)
                .setName("Finished")
                .setDescription("An agent finished its turn")
                .build(),
            NotificationChannelCompat.Builder(SUBAGENTS, IMPORTANCE_LOW)
                .setName("Sub-agents")
                .setDescription("A sub-agent finished")
                .build(),
            NotificationChannelCompat.Builder(CONNECTION, IMPORTANCE_LOW)
                .setName("Connection")
                .setDescription("Which laptop the app is connected to")
                .setSound(null, null)
                .setVibrationEnabled(false)
                .build()
        )
        NotificationManagerCompat.from(context).createNotificationChannelsCompat(channels)
    }
}
