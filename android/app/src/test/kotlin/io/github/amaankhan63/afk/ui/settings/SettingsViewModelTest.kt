package io.github.amaankhan63.afk.ui.settings

import android.content.Context
import io.github.amaankhan63.afk.data.InMemoryDataStore
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_DISCONNECTED
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.DaemonSettings
import io.github.amaankhan63.afk.data.protocol.DaemonSettingsPatch
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.HELLO
import io.github.amaankhan63.afk.data.settings.AppSettingsStore
import io.github.amaankhan63.afk.ui.session.StripChip
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** Robolectric: the view model reads the app's version from the package manager. */
@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
@RunWith(RobolectricTestRunner::class)
class SettingsViewModelTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val repo = FakeSessionsRepository()

    // One preferences file, as in the app: the settings and the pairing share it.
    private val dataStore = InMemoryDataStore()
    private val pairingStore = PairingStore(dataStore)
    private val pairing = PairingPayload("100.84.12.9", 2351, "tok_abc")

    /** What happened on unpair, in order. */
    private val events = mutableListOf<String>()

    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.viewModel() = SettingsViewModel(
        AppSettingsStore(dataStore, backgroundScope),
        repo,
        pairingStore,
        context,
        stopService = {
            assertEquals(context, it)
            val cleared = dataStore.current.asMap().isEmpty()
            events += if (cleared) "stop after clear" else "stop before clear"
        }
    )

    @Test fun keepAwakeToggleSendsDaemonSettingsSet() = runTest {
        repo.daemonSettings.value = DaemonSettings(keepAwake = true)
        val vm = viewModel()
        assertEquals(true, vm.ui.value.keepAwake)

        vm.setKeepAwake(false)

        assertEquals(listOf(DaemonSettingsPatch(keepAwake = false)), repo.settingsPatches)
        assertFalse(vm.ui.value.keepAwakeBusy)
    }

    @Test fun keepAwakeSendsOneRequestAtATimeAndReportsFailure() = runTest {
        repo.daemonSettings.value = DaemonSettings(keepAwake = true)
        val reply = CompletableDeferred<Result<DaemonSettings>>()
        repo.settingsReply = reply
        val vm = viewModel()
        val errors = mutableListOf<AfkError>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            vm.errors.toList(errors)
        }

        vm.setKeepAwake(false)
        vm.setKeepAwake(false)
        assertTrue(vm.ui.value.keepAwakeBusy)
        assertEquals(1, repo.settingsPatches.size)

        reply.complete(Result.failure(AfkError(ERROR_DISCONNECTED, "not connected to the daemon")))
        assertFalse(vm.ui.value.keepAwakeBusy)
        assertEquals(listOf("Not connected"), errors.map { it.message })
        assertEquals(true, vm.ui.value.keepAwake)
    }

    @Test fun unpairClearsStoreAndStopsService() = runTest {
        pairingStore.save(pairing)
        val vm = viewModel()

        vm.unpair { events += "done" }

        assertNull(pairingStore.pairing.first())
        assertEquals(listOf("stop after clear", "done"), events)
    }

    @Test fun laptopComesFromHelloElseFromThePairing() = runTest {
        pairingStore.save(pairing)
        repo.daemonSettings.value = DaemonSettings(keepAwakeGraceMin = 15)
        val vm = viewModel()

        val offline = vm.ui.value
        assertNull(offline.hostname)
        assertEquals("100.84.12.9:2351", offline.address)
        assertFalse(offline.connected)
        assertEquals(15, offline.graceMin)

        repo.connection.value = ConnectionState.Connected(HELLO)
        val online = vm.ui.value
        assertEquals("MY-LAPTOP", online.hostname)
        assertEquals("100.84.12.9", online.address)
        assertTrue(online.connected)

        // Until the daemon's settings arrive the switch has no state to show.
        repo.daemonSettings.value = null
        assertNull(vm.ui.value.keepAwake)
        assertEquals(10, vm.ui.value.graceMin)
    }

    @Test fun chipsKeepTheStripOrder() = runTest {
        val vm = viewModel()

        vm.setChip(StripChip.Memory, shown = true)
        vm.setChip(StripChip.Model, shown = false)
        vm.setChip(StripChip.CtxSize, shown = true)

        val chips = AppSettingsStore(dataStore, backgroundScope).settings
            .first { StripChip.CtxSize in it.stripChips }
            .stripChips
        assertEquals(
            listOf(
                StripChip.Thinking,
                StripChip.CtxUsed,
                StripChip.CtxSize,
                StripChip.Cost,
                StripChip.FiveHour,
                StripChip.SessionTime,
                StripChip.Memory
            ),
            chips
        )
    }
}
