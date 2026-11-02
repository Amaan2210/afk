package io.github.amaankhan63.afk.service

import android.app.NotificationManager
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class NotificationChannelsTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val manager = context.getSystemService(NotificationManager::class.java)

    @Test fun ensureCreatesEachChannelOnceWithItsImportance() {
        NotificationChannels.ensure(context)
        NotificationChannels.ensure(context)

        val importance = manager.notificationChannels.associate { it.id to it.importance }
        assertEquals(
            mapOf(
                NotificationChannels.NEEDS_INPUT to NotificationManager.IMPORTANCE_HIGH,
                NotificationChannels.FINISHED to NotificationManager.IMPORTANCE_DEFAULT,
                NotificationChannels.SUBAGENTS to NotificationManager.IMPORTANCE_LOW,
                NotificationChannels.CONNECTION to NotificationManager.IMPORTANCE_LOW
            ),
            importance
        )
        assertEquals(4, manager.notificationChannels.size)
    }

    @Test fun connectionChannelIsSilent() {
        NotificationChannels.ensure(context)

        val connection = manager.getNotificationChannel(NotificationChannels.CONNECTION)
        assertNull(connection.sound)
        assertFalse(connection.shouldVibrate())
    }
}
