package io.github.amaankhan63.afk.ui.pairing

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.amaankhan63.afk.data.InMemoryDataStore
import io.github.amaankhan63.afk.data.connection.ConnectionManager
import io.github.amaankhan63.afk.data.connection.ConnectionManagerFactory
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.Endpoint
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.DaemonInfo
import io.github.amaankhan63.afk.data.protocol.DeviceInfo
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, runCurrent, advanceTimeBy
class PairingViewModelTest {
    private val factory = FakeConnectionFactory()
    private val store = PairingStore(InMemoryDataStore())
    private val hello = ServerMessage.Hello(
        protocol = 1,
        daemon = DaemonInfo("0.1.0", "MY-LAPTOP", "win32", "100.84.12.9"),
        device = DeviceInfo("dev_8f3a", "Pixel 8")
    )
    private val scanned = """{"afk":1,"host":"100.84.12.9","port":2351,"token":"tok_abc"}"""

    // viewModelScope runs on Dispatchers.Main; runTest shares this dispatcher's virtual clock.
    @Before fun setUp() = Dispatchers.setMain(StandardTestDispatcher())

    @After fun tearDown() = Dispatchers.resetMain()

    private fun viewModel() = PairingViewModel(store, factory)

    private fun PairingViewModel.fill() = onEdit("100.84.12.9", "2351", "tok_abc")

    /** [manager] was stopped exactly once and the scope it was made with is cancelled. */
    private fun assertReleased(manager: FakeConnectionManager = factory.managers.single()) {
        assertEquals(1, manager.stops)
        assertFalse(factory.scopes[factory.managers.indexOf(manager)].isActive)
    }

    /** A ViewModel whose fields passed a test against MY-LAPTOP. */
    private fun TestScope.connectedViewModel(): PairingViewModel {
        val vm = viewModel()
        vm.fill()
        vm.testConnection()
        runCurrent()
        factory.managers.last().state.value = ConnectionState.Connected(hello)
        runCurrent()
        assertEquals(TestResult.Ok("MY-LAPTOP"), vm.ui.value.result)
        return vm
    }

    @Test fun scanFillsFields() {
        val vm = viewModel()
        vm.onScanned(scanned)
        assertEquals(
            PairingUiState(host = "100.84.12.9", port = "2351", token = "tok_abc"),
            vm.ui.value
        )
    }

    @Test fun scanOfSomethingElseKeepsFieldsAndSaysWhy() {
        val vm = viewModel()
        vm.fill()
        vm.onScanned("https://example.com")
        assertEquals(
            PairingUiState(
                host = "100.84.12.9",
                port = "2351",
                token = "tok_abc",
                result = TestResult.Failed("That QR code is not an AFK pairing code")
            ),
            vm.ui.value
        )
    }

    @Test fun testConnectionReportsHostname() = runTest {
        val vm = viewModel()
        vm.fill()

        vm.testConnection()
        runCurrent()
        assertTrue(vm.ui.value.testing)
        val manager = factory.managers.single()
        assertEquals(Endpoint("100.84.12.9", 2351) to "tok_abc", manager.started)

        manager.state.value = ConnectionState.Connected(hello)
        runCurrent()
        assertEquals(TestResult.Ok("MY-LAPTOP"), vm.ui.value.result)
        assertFalse(vm.ui.value.testing)
        assertReleased()
    }

    @Test fun testConnectionTestsTrimmedValues() = runTest {
        val vm = viewModel()
        vm.onEdit(" 100.84.12.9 ", " 2351 ", " tok_abc ")
        vm.testConnection()
        runCurrent()
        assertEquals(
            Endpoint("100.84.12.9", 2351) to "tok_abc",
            factory.managers.single().started
        )
    }

    @Test fun testConnectionReportsUnauthorized() = runTest {
        val vm = viewModel()
        vm.fill()
        vm.testConnection()
        runCurrent()

        factory.managers.single().state.value = ConnectionState.Failed("unauthorized")
        runCurrent()
        assertEquals(TestResult.Failed("Token rejected"), vm.ui.value.result)
        assertFalse(vm.ui.value.testing)
        assertReleased()
    }

    @Test fun failureCodesReadAsSentences() = runTest {
        val expected = mapOf(
            "protocol_mismatch" to "App and daemon versions do not match",
            "bad_endpoint" to "Cannot open a connection to that address",
            "server_busy" to "server_busy"
        )
        val vm = viewModel()
        vm.fill()
        for ((code, reason) in expected) {
            vm.testConnection()
            runCurrent()
            val manager = factory.managers.last()
            manager.state.value = ConnectionState.Failed(code)
            runCurrent()
            assertEquals(TestResult.Failed(reason), vm.ui.value.result)
            assertReleased(manager)
        }
    }

    @Test fun testConnectionTimesOutAfterTenSeconds() = runTest {
        val vm = viewModel()
        vm.fill()
        vm.testConnection()
        runCurrent()

        advanceTimeBy(9_999)
        runCurrent()
        assertTrue(vm.ui.value.testing)
        assertEquals(0, factory.managers.single().stops)

        advanceTimeBy(1)
        runCurrent()
        val reason = (vm.ui.value.result as TestResult.Failed).reason
        assertTrue(reason, reason.startsWith("No answer from the laptop"))
        assertFalse(vm.ui.value.testing)
        assertReleased()
    }

    @Test fun secondTapWhileTestingIsIgnored() = runTest {
        val vm = viewModel()
        vm.fill()
        vm.testConnection()
        runCurrent()
        vm.testConnection()
        runCurrent()
        assertEquals(1, factory.managers.size)
        assertTrue(vm.ui.value.testing)
    }

    @Test fun badPortFailsWithoutConnecting() = runTest {
        val vm = viewModel()
        for (port in listOf("abc", "", "0", "65536", "2350.5")) {
            vm.onEdit("100.84.12.9", port, "tok_abc")
            vm.testConnection()
            runCurrent()
            assertEquals(
                "port <$port>",
                TestResult.Failed("Port must be 1–65535"),
                vm.ui.value.result
            )
            assertFalse(vm.ui.value.testing)
        }
        assertTrue(factory.managers.isEmpty())
    }

    /** The one step a scanned code and the Connect button take. */
    @Test fun connectSavesOnceTheLaptopAccepts() = runTest {
        val vm = viewModel()
        var done = 0
        assertTrue(vm.onScanned(scanned))

        vm.connect { done++ }
        runCurrent()
        assertEquals(0, done)
        assertNull(store.pairing.first())

        factory.managers.single().state.value = ConnectionState.Connected(hello)
        runCurrent()
        assertEquals(1, done)
        assertEquals(PairingPayload("100.84.12.9", 2351, "tok_abc"), store.pairing.first())
    }

    @Test fun connectSavesNothingTheLaptopRefuses() = runTest {
        val vm = viewModel()
        var done = 0
        vm.fill()

        vm.connect { done++ }
        runCurrent()
        factory.managers.single().state.value = ConnectionState.Failed("unauthorized")
        runCurrent()

        assertEquals(0, done)
        assertNull(store.pairing.first())
        assertEquals(TestResult.Failed("Token rejected"), vm.ui.value.result)
    }

    @Test fun aScanOfSomethingElseSaysItIsNotACode() {
        assertFalse(viewModel().onScanned("https://example.com"))
    }

    @Test fun editDuringTestCancelsIt() = runTest {
        val vm = viewModel()
        vm.fill()
        vm.testConnection()
        runCurrent()

        vm.onEdit("100.84.12.10", "2351", "tok_abc")
        runCurrent()
        assertFalse(vm.ui.value.testing)
        assertNull(vm.ui.value.result)
        assertReleased()

        // A late answer to the cancelled test changes nothing.
        factory.managers.single().state.value = ConnectionState.Connected(hello)
        runCurrent()
        assertNull(vm.ui.value.result)
    }

    @Test fun editAfterSuccessClearsResult() = runTest {
        val vm = connectedViewModel()
        vm.onEdit("100.84.12.9", "2351", "tok_other")
        assertEquals(PairingUiState("100.84.12.9", "2351", "tok_other"), vm.ui.value)
    }

    @Test fun editWithUnchangedValuesKeepsResult() = runTest {
        val vm = connectedViewModel()
        vm.fill()
        assertEquals(TestResult.Ok("MY-LAPTOP"), vm.ui.value.result)
    }

    @Test fun saveStoresTheTestedPairing() = runTest {
        val vm = connectedViewModel()
        var done = 0
        vm.save { done++ }
        runCurrent()
        assertEquals(PairingPayload("100.84.12.9", 2351, "tok_abc"), store.pairing.first())
        assertEquals(1, done)
    }

    @Test fun saveBeforeASuccessfulTestDoesNothing() = runTest {
        val vm = viewModel()
        vm.fill()
        var done = 0
        vm.save { done++ }
        runCurrent()
        assertNull(store.pairing.first())
        assertEquals(0, done)
    }

    @Test fun clearingTheViewModelReleasesARunningTest() = runTest {
        val owner = ViewModelStore()
        val vm = ViewModelProvider.create(
            owner,
            viewModelFactory { initializer { PairingViewModel(store, factory) } }
        )[PairingViewModel::class]
        vm.fill()
        vm.testConnection()
        runCurrent()

        owner.clear()
        runCurrent()
        assertReleased()
    }
}

/** Plays the daemon through [state]; records how the ViewModel drives it. */
private class FakeConnectionManager : ConnectionManager {
    override val state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    override val incoming = MutableSharedFlow<ServerMessage>()
    var started: Pair<Endpoint, String>? = null
    var stops = 0

    override fun start(endpoint: Endpoint, token: String) {
        started = endpoint to token
        state.value = ConnectionState.Connecting(0)
    }

    override fun stop() {
        stops++
        state.value = ConnectionState.Disconnected
    }

    override suspend fun request(msg: ClientMessage, timeoutMs: Long): ServerMessage =
        error("pairing sends no requests")

    override fun send(msg: ClientMessage): Unit = error("pairing sends nothing")

    override fun onNetworkLost() = Unit

    override fun onNetworkAvailable() = Unit
}

/** Hands out [FakeConnectionManager]s and keeps the scope each was made with. */
private class FakeConnectionFactory : ConnectionManagerFactory {
    val managers = mutableListOf<FakeConnectionManager>()
    val scopes = mutableListOf<CoroutineScope>()

    override fun create(scope: CoroutineScope): ConnectionManager {
        scopes += scope
        return FakeConnectionManager().also { managers += it }
    }
}
