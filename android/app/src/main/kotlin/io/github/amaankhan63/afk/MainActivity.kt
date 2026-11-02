package io.github.amaankhan63.afk

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dagger.hilt.android.AndroidEntryPoint
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.service.AfkConnectionService
import javax.inject.Inject
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var pairingStore: PairingStore

    // A denial is accepted as it is: sessions still work, only their notifications stay hidden.
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Text("AFK") }
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

    /** Asks for POST_NOTIFICATIONS (API 33+) once per launch, while it is not granted. */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val permission = Manifest.permission.POST_NOTIFICATIONS
        val granted = ContextCompat.checkSelfPermission(this, permission) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermission.launch(permission)
    }
}
