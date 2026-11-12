package io.github.amaankhan63.afk.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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

/**
 * Whether the banner shows in [connection]: once a connection has dropped or been refused. Not
 * for the first try after a start, which is over in a moment, nor before the app is started.
 */
fun showsBanner(connection: ConnectionState): Boolean = when (connection) {
    is ConnectionState.Connecting -> connection.attempt > 0
    is ConnectionState.Failed -> true
    is ConnectionState.Connected, ConnectionState.Disconnected -> false
}

/**
 * [content], the app's screens, under a banner that drops in from the top while the app is
 * [paired] but not connected (see [showsBanner]) and slides away once it is. The banner takes the
 * status bar's place, so the screens under it keep clear of neither twice.
 */
@Composable
fun OfflineFrame(
    connection: ConnectionState,
    paired: Boolean,
    host: String?,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    val visible = paired && showsBanner(connection)
    // What the banner said last, so it still says it while it slides away.
    var last by remember { mutableStateOf(connection) }
    if (visible && last != connection) last = connection
    Column(modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = visible,
            enter = expandVertically() + slideInVertically { -it },
            exit = shrinkVertically() + slideOutVertically { -it }
        ) {
            val colors = MaterialTheme.colorScheme
            val retrying = last is ConnectionState.Connecting
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(if (retrying) colors.tertiaryContainer else colors.errorContainer)
                    .statusBarsPadding()
            ) {
                OfflineBanner(last, host = host)
            }
        }
        val screens = if (visible) {
            Modifier.consumeWindowInsets(WindowInsets.statusBars)
        } else {
            Modifier
        }
        Box(Modifier.weight(1f).then(screens)) { content() }
    }
}
