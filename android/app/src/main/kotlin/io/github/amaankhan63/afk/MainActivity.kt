package io.github.amaankhan63.afk

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dagger.hilt.android.AndroidEntryPoint
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import io.github.amaankhan63.afk.service.AfkConnectionService
import io.github.amaankhan63.afk.ui.navigation.AfkNavHost
import io.github.amaankhan63.afk.ui.navigation.Routes
import io.github.amaankhan63.afk.ui.theme.AfkTheme
import io.github.amaankhan63.afk.ui.theme.LocalAfkDark
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

// The navigation bar's scrims in three-button mode, as androidx.activity's own defaults, which it
// keeps internal.
private val LIGHT_SCRIM = Color.argb(0xe6, 0xff, 0xff, 0xff)
private val DARK_SCRIM = Color.argb(0x80, 0x1b, 0x1b, 0x1b)

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var pairingStore: PairingStore

    @Inject lateinit var settingsStore: AppSettingsStore

    // A denial is accepted as it is: sessions still work, only their notifications stay hidden.
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    /** The route a notification's link asked for, until the navigation opens it. */
    private val deepLink = MutableStateFlow<String?>(null)

    /** Whether the start destination is known; the splash stays until it is. */
    private var startReady by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before super.onCreate, as the library requires: it ends the launch screen and swaps the
        // splash theme for Theme.Afk. The splash stays until the first screen is known, rather
        // than giving way to a blank frame.
        installSplashScreen().setKeepOnScreenCondition { !startReady }
        super.onCreate(savedInstanceState)
        // Also how the keyboard's insets reach Compose below Android 15.
        enableEdgeToEdge()
        // A recreated activity's navigation already holds the screen the link opened.
        if (savedInstanceState == null) openLink(intent)
        // The navigation reads its own deep-link extras from the launch intent when its graph is
        // set, and any app can start this activity with them: they could open any screen, even
        // one without its arguments. The app reads only the intent's link, so the extras go.
        intent.replaceExtras(Bundle())
        setContent {
            val settings by settingsStore.settings.collectAsStateWithLifecycle()
            AfkTheme(settings.theme, settings.mode) {
                // The bare call above picks the bars' icons by the phone's night mode, read once;
                // Settings can force the app light or dark, so the icons follow the app instead.
                val dark = LocalAfkDark.current
                DisposableEffect(dark) {
                    enableEdgeToEdge(
                        statusBarStyle =
                            SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark },
                        navigationBarStyle = SystemBarStyle.auto(LIGHT_SCRIM, DARK_SCRIM) { dark }
                    )
                    onDispose {}
                }
                val start by produceState<String?>(initialValue = null) {
                    // Preferences that cannot be read hold no pairing.
                    val pairing = try {
                        pairingStore.pairing.first()
                    } catch (e: IOException) {
                        null
                    }
                    value = if (pairing != null) Routes.SESSIONS else Routes.PAIRING
                    startReady = true
                }
                val link by deepLink.collectAsStateWithLifecycle()
                val destination = start
                if (destination == null) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {}
                } else {
                    AfkNavHost(
                        startDestination = destination,
                        deepLink = link,
                        onDeepLinkConsumed = { deepLink.value = null }
                    )
                }
            }
        }
        if (savedInstanceState == null) requestNotificationPermission()
        // Starts the connection service whenever a pairing exists, one saved in the app included.
        // Starting it again while it runs is harmless.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                pairingStore.pairing.filterNotNull().collect {
                    AfkConnectionService.start(applicationContext)
                }
            }
        }
    }

    /** A notification tapped while the app runs: its link comes here, not to [onCreate]. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openLink(intent)
    }

    /** The link [intent] carries is untrusted: only [Routes.parseDeepLink] turns it into a route. */
    private fun openLink(intent: Intent) {
        intent.data?.let(Routes::parseDeepLink)?.let { deepLink.value = it }
    }

    /** Asks for POST_NOTIFICATIONS (API 33+) once per launch, while it is not granted. */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val permission = Manifest.permission.POST_NOTIFICATIONS
        val granted = ContextCompat.checkSelfPermission(this, permission) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermission.launch(permission)
    }
}
