package io.github.amaankhan63.afk.data.connection

import android.content.Context
import android.content.pm.ApplicationInfo
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * The daemon speaks plain `ws://` over Tailscale, which encrypts the link. From Android 9 the
 * platform refuses cleartext unless the app allows it, and the connection would fail forever.
 */
@RunWith(RobolectricTestRunner::class)
class CleartextTrafficTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    @Test fun theManifestAllowsCleartextTraffic() {
        val flags = context.applicationInfo.flags
        assertTrue(flags and ApplicationInfo.FLAG_USES_CLEARTEXT_TRAFFIC != 0)
    }

    @Test fun theEndpointIsPlainWebSocket() {
        assertTrue(Endpoint("100.84.12.9").wsUrl().startsWith("ws://"))
    }
}
