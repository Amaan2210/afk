package io.github.amaankhan63.afk.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import io.github.amaankhan63.afk.ui.session.StripChip
import javax.inject.Qualifier
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** The status strip's chips as Settings picks them, in order. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class StripChipsFlow

@Module
@InstallIn(SingletonComponent::class)
object SettingsModule {
    @Provides
    @StripChipsFlow
    fun provideStripChips(store: AppSettingsStore): Flow<List<StripChip>> =
        store.settings.map { it.stripChips }.distinctUntilChanged()
}
