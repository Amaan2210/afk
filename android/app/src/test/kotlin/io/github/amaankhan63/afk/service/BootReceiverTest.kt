package io.github.amaankhan63.afk.service

import io.github.amaankhan63.afk.data.InMemoryDataStore
import io.github.amaankhan63.afk.data.pairing.PairingPayload
import io.github.amaankhan63.afk.data.pairing.PairingStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class BootReceiverTest {
    private val dataStore = InMemoryDataStore()
    private val store = PairingStore(dataStore)
    private var started = 0

    @Test fun aPairingReconnectsAtBoot() = runTest {
        store.save(PairingPayload("100.84.12.9", 2350, "tok_abc"))

        reconnectIfPaired(store.pairingOrNone) { started++ }

        assertEquals(1, started)
    }

    @Test fun noPairingStartsNothing() = runTest {
        reconnectIfPaired(store.pairingOrNone) { started++ }

        assertEquals(0, started)
    }

    /** Preferences that cannot be read count as no pairing, rather than crashing at boot. */
    @Test fun anUnreadablePairingStartsNothing() = runTest {
        store.save(PairingPayload("100.84.12.9", 2350, "tok_abc"))
        dataStore.readFailures = 1

        reconnectIfPaired(store.pairingOrNone) { started++ }

        assertEquals(0, started)
    }
}
