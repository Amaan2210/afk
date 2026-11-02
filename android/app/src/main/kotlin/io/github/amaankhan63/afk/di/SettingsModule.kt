package io.github.amaankhan63.afk.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.github.amaankhan63.afk.ui.session.DEFAULT_STRIP_CHIPS
import io.github.amaankhan63.afk.ui.session.StripChip
import javax.inject.Qualifier
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/** The status strip's chips as Settings picks them, in order. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class StripChipsFlow

@Module
@InstallIn(SingletonComponent::class)
object SettingsModule {
    /** The defaults, until the app's settings store (Task 14) provides the user's choice. */
    @Provides
    @StripChipsFlow
    fun provideStripChips(): Flow<List<StripChip>> = flowOf(DEFAULT_STRIP_CHIPS)
}
