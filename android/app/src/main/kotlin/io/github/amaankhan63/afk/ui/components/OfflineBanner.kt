package io.github.amaankhan63.afk.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.connection.failureText

/**
 * A full-width line saying why the app is not connected to [host], the laptop's name or address;
 * nothing while [connection] is connected. Screen readers announce it as it changes.
 */
@Composable
fun OfflineBanner(
    connection: ConnectionState,
    modifier: Modifier = Modifier,
    host: String? = null
) {
    val text = bannerText(connection, host) ?: return
    val colors = MaterialTheme.colorScheme
    // Amber-ish while it retries on its own; the error colours once it has stopped.
    val (container, content) = if (connection is ConnectionState.Connecting) {
        colors.tertiaryContainer to colors.onTertiaryContainer
    } else {
        colors.errorContainer to colors.onErrorContainer
    }
    Text(
        text = text,
        modifier = modifier
            .fillMaxWidth()
            .background(container)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = content,
        style = MaterialTheme.typography.bodySmall
    )
}

/**
 * What the offline banner says in [connection], naming [host] (the laptop when unknown); null while
 * connected. Attempt 0 is the first try after a start, before anything has dropped.
 */
fun bannerText(connection: ConnectionState, host: String?): String? {
    val laptop = host ?: "the laptop"
    return when (connection) {
        is ConnectionState.Connected -> null

        is ConnectionState.Connecting -> if (connection.attempt == 0) {
            "Connecting to $laptop…"
        } else {
            "Reconnecting to $laptop… (attempt ${connection.attempt})"
        }

        ConnectionState.Disconnected -> "Not connected"

        is ConnectionState.Failed -> failureText(connection.code, host)
    }
}

/**
 * The laptop the banner names: its [hostname] from the latest `hello` when there is one, else the
 * [pairingHost] the app was paired with.
 */
fun bannerHost(hostname: String?, pairingHost: String?): String? = hostname ?: pairingHost
