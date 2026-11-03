package io.github.amaankhan63.afk.ui.settings

import io.github.amaankhan63.afk.data.InMemoryDataStore
import io.github.amaankhan63.afk.data.settings.AppSettings
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
class AppSettingsViewModelTest {
    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    /** A pinch saves the size, so Settings' slider and the next session show it too. */
    @Test fun setFontSizePersists() = runTest {
        val dataStore = InMemoryDataStore()
        val vm = AppSettingsViewModel(AppSettingsStore(dataStore, backgroundScope))

        vm.setFontSize(15)

        val reread = AppSettingsStore(dataStore, backgroundScope).settings
            .first { it != AppSettings() }
        assertEquals(15, reread.terminalFontSp)
        assertEquals(15, vm.settings.first { it != AppSettings() }.terminalFontSp)
    }
}
