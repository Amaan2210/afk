package io.github.amaankhan63.afk.ui.settings

import androidx.core.content.ContextCompat
import io.github.amaankhan63.afk.R
import io.github.amaankhan63.afk.service.SessionNotifier
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode

/**
 * Robolectric: the app's own icons inflate. A malformed vector path passes the build and lint and
 * would only fail when Android first inflates the icon. Native graphics: the legacy mode's path
 * parser accepts what Android's rejects.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AppIconsTest {
    @Test fun everyIconInflates() {
        val app = RuntimeEnvironment.getApplication()
        mapOf(
            "ic_launcher_foreground" to R.drawable.ic_launcher_foreground,
            "ic_launcher_monochrome" to R.drawable.ic_launcher_monochrome,
            "ic_stat_afk" to R.drawable.ic_stat_afk,
            "ic_launcher" to R.mipmap.ic_launcher,
            "ic_launcher_round" to R.mipmap.ic_launcher_round,
            "SessionNotifier.SMALL_ICON" to SessionNotifier.SMALL_ICON
        ).forEach { (name, id) -> assertNotNull(name, ContextCompat.getDrawable(app, id)) }
    }
}
