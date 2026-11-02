package io.github.amaankhan63.afk.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import io.github.amaankhan63.afk.di.AppScope
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope

/** Receives the actions of session notifications; [NotificationActionHandler] does the work. */
@AndroidEntryPoint
class NotificationActionReceiver : BroadcastReceiver() {
    @Inject lateinit var repo: SessionsRepository

    @Inject @AppScope
    lateinit var scope: CoroutineScope

    override fun onReceive(context: Context, intent: Intent) {
        val result = goAsync()
        NotificationActionHandler(repo, scope)
            .dispatch(context.applicationContext, intent) { result.finish() }
    }
}
