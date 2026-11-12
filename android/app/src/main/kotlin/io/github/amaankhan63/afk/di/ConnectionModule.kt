package io.github.amaankhan63.afk.di

import android.os.Build
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.github.amaankhan63.afk.data.connection.Backoff
import io.github.amaankhan63.afk.data.connection.ConnectionManagerFactory
import io.github.amaankhan63.afk.data.connection.DefaultConnectionManager
import io.github.amaankhan63.afk.data.connection.OkHttpAfkSocket
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import okhttp3.OkHttpClient

@Module
@InstallIn(SingletonComponent::class)
object ConnectionModule {
    /**
     * Pings every 10 s, so a connection that died silently fails within about 20 s instead of
     * hanging; the connection service is also told at once when a network goes.
     */
    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient = OkHttpClient.Builder()
        .pingInterval(10, TimeUnit.SECONDS)
        .build()

    /** Each manager gets its own socket: an [OkHttpAfkSocket] carries one connection at a time. */
    @Provides
    fun provideConnectionManagerFactory(client: OkHttpClient): ConnectionManagerFactory {
        val clientName = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android"
        return ConnectionManagerFactory { scope ->
            DefaultConnectionManager(OkHttpAfkSocket(client), Backoff(), scope, clientName)
        }
    }
}
