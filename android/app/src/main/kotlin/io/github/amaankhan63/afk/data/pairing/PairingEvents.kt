package io.github.amaankhan63.afk.data.pairing

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Why the app is back at the pairing screen, when it was not the owner's own Unpair: the laptop
 * stopped accepting this phone. The pairing screen shows [notice] until the phone is paired
 * again, which clears it.
 */
@Singleton
class PairingEvents @Inject constructor() {
    private val mutableNotice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = mutableNotice.asStateFlow()

    fun say(text: String) {
        mutableNotice.value = text
    }

    fun clear() {
        mutableNotice.value = null
    }
}
