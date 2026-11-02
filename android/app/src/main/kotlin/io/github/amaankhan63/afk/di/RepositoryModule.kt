package io.github.amaankhan63.afk.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.connection.ConnectionManagerFactory
import io.github.amaankhan63.afk.data.sessions.DefaultSessionsRepository
import io.github.amaankhan63.afk.data.sessions.SessionsRepository
import javax.inject.Qualifier
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** The scope of work that lives as long as the app process, such as the app-wide connection. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class AppScope

@Module
@InstallIn(SingletonComponent::class)
object RepositoryModule {
    @Provides
    @Singleton
    @AppScope
    fun provideAppScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The app's one connection to the daemon; the foreground service starts and stops it. */
    @Provides
    @Singleton
    fun provideConnectionManager(
        factory: ConnectionManagerFactory,
        @AppScope scope: CoroutineScope
    ): ConnectionManager = factory.create(scope)

    @Provides
    @Singleton
    fun provideSessionsRepository(
        manager: ConnectionManager,
        @AppScope scope: CoroutineScope
    ): SessionsRepository = DefaultSessionsRepository(manager, scope)
}
