package io.github.amaankhan63.afk.service

import android.content.Context
import android.content.Intent
import io.github.amaankhan63.afk.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class AfkConnectionServiceTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    /** A running app is brought forward as it is, not started again on top of itself. */
    @Test fun connectionNotificationReusesTheRunningActivity() {
        val intent = AfkConnectionService.openAppIntent(context)

        assertEquals(MainActivity::class.java.name, intent.component?.className)
        assertNull(intent.data)
        val flags = Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP
        assertEquals(flags, intent.flags and flags)
    }
}
