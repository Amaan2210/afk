package io.github.amaankhan63.afk.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.di.AppScope
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** Reconnects to the laptop after the phone restarts, when the app is paired. */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {
    @Inject lateinit var pairingStore: PairingStore

    @Inject @AppScope
    lateinit var scope: CoroutineScope

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext
        val result = goAsync()
        scope.launch {
            try {
                if (pairingStore.pairing.first() != null) AfkConnectionService.start(app)
            } finally {
                result.finish()
            }
        }
    }
}
