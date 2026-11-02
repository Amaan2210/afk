package io.github.amaankhan63.afk.ui.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.amaankhan63.afk.data.connection.ConnectionManagerFactory
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.ERROR_BAD_ENDPOINT
import io.github.amaankhan63.afk.data.connection.Endpoint
import io.github.amaankhan63.afk.data.pairing.PairingCodec
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** The pairing fields as typed; [result] describes the last test of exactly these values. */
data class PairingUiState(
    val host: String = "",
    val port: String = "2350",
    val token: String = "",
    val testing: Boolean = false,
    val result: TestResult? = null
)

sealed interface TestResult {
    /** The daemon accepted the token; [hostname] is the computer's name from its `hello`. */
    data class Ok(val hostname: String) : TestResult

    data class Failed(val reason: String) : TestResult
}

/** Takes pairing values from a QR code or by hand, tests them, and saves them once they pass. */
@HiltViewModel
class PairingViewModel @Inject constructor(
    private val store: PairingStore,
    private val connectionFactory: ConnectionManagerFactory
) : ViewModel() {
    private val mutableUi = MutableStateFlow(PairingUiState())
    val ui: StateFlow<PairingUiState> = mutableUi.asStateFlow()

    /** The running test; cancelled when the values it tests change. */
    private var test: Job? = null
    private var saving: Job? = null

    /** Fills the fields from a scanned QR code, or keeps them and says it is not a pairing code. */
    fun onScanned(raw: String) {
        cancelTest()
        mutableUi.value = PairingCodec.parse(raw).fold(
            onSuccess = { PairingUiState(it.host, it.port.toString(), it.token) },
            onFailure = {
                val reason = TestResult.Failed(NOT_A_PAIRING_CODE)
                mutableUi.value.copy(testing = false, result = reason)
            }
        )
    }

    /** New values void the last test and stop a running one. */
    fun onEdit(host: String, port: String, token: String) {
        val current = mutableUi.value
        if (host == current.host && port == current.port && token == current.token) return
        cancelTest()
        mutableUi.value = PairingUiState(host, port, token)
    }

    /** Connects once with the fields' values; ignored while a test is running. */
    fun testConnection() {
        val current = mutableUi.value
        if (current.testing) return
        val port = current.port.trim().toIntOrNull()
        if (port == null || port !in 1..65535) {
            mutableUi.update { it.copy(result = TestResult.Failed(PORT_OUT_OF_RANGE)) }
            return
        }
        val endpoint = Endpoint(current.host.trim(), port)
        val token = current.token.trim()
        mutableUi.update { it.copy(testing = true, result = null) }
        test = viewModelScope.launch {
            val result = probe(endpoint, token)
            mutableUi.update { it.copy(testing = false, result = result) }
        }
    }

    /** Saves the values the last test accepted, then calls [onDone]; does nothing before that. */
    fun save(onDone: () -> Unit) {
        val current = mutableUi.value
        if (current.result !is TestResult.Ok || saving?.isActive == true) return
        val port = current.port.trim().toIntOrNull() ?: return
        val pairing = PairingPayload(current.host.trim(), port, current.token.trim())
        saving = viewModelScope.launch {
            store.save(pairing)
            onDone()
        }
    }

    /**
     * Waits up to 10 s for a throwaway manager to reach `Connected` or `Failed`. However it ends,
     * returning, timing out or cancelled, the manager is stopped and its scope cancelled.
     */
    private suspend fun probe(endpoint: Endpoint, token: String): TestResult {
        // The ViewModel's dispatcher but a Job of its own, so the manager's collectors die with it.
        val attempt = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val manager = connectionFactory.create(attempt)
        try {
            manager.start(endpoint, token)
            val end = withTimeoutOrNull(TEST_TIMEOUT_MS) {
                manager.state.first { state ->
                    state is ConnectionState.Connected || state is ConnectionState.Failed
                }
            }
            return when (end) {
                is ConnectionState.Connected -> TestResult.Ok(end.hello.daemon.hostname)
                is ConnectionState.Failed -> TestResult.Failed(describe(end.code))
                else -> TestResult.Failed(TIMED_OUT)
            }
        } finally {
            manager.stop()
            attempt.cancel()
        }
    }

    private fun cancelTest() {
        test?.cancel()
        test = null
    }

    private companion object {
        const val TEST_TIMEOUT_MS = 10_000L
        const val TIMED_OUT = "Timed out"
        const val PORT_OUT_OF_RANGE = "Port must be 1–65535"
        const val NOT_A_PAIRING_CODE = "That QR code is not an AFK pairing code"

        /** A [ConnectionState.Failed] code as the person pairing should read it. */
        fun describe(code: String): String = when (code) {
            "unauthorized" -> "Token rejected"
            "protocol_mismatch" -> "App and daemon versions do not match"
            ERROR_BAD_ENDPOINT -> "Cannot open a connection to that address"
            else -> code
        }
    }
}
