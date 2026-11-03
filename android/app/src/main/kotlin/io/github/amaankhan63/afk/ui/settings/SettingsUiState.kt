package io.github.amaankhan63.afk.ui.settings

import io.github.amaankhan63.afk.data.settings.AppSettings

/**
 * The Settings screen: the app's [settings], and the paired laptop. [hostname] is the laptop's
 * name while connected; [address] is its Tailscale address while connected, else the pairing's
 * `host:port`. [keepAwake] is the daemon's switch, null until its settings arrive;
 * [keepAwakeBusy] holds while a change of it waits for the daemon. The daemon releases the laptop
 * [graceMin] minutes after the last agent goes idle. [version] is the app's.
 */
data class SettingsUiState(
    val settings: AppSettings = AppSettings(),
    val hostname: String? = null,
    val address: String? = null,
    val connected: Boolean = false,
    val keepAwake: Boolean? = null,
    val keepAwakeBusy: Boolean = false,
    val graceMin: Int = DEFAULT_GRACE_MIN,
    val version: String = ""
)

/** The daemon's own default for its keep-awake grace period, in minutes. */
internal const val DEFAULT_GRACE_MIN = 10
