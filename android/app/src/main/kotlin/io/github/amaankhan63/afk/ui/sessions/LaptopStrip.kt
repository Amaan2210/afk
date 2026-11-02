package io.github.amaankhan63.afk.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.ui.components.Dot
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette
import io.github.amaankhan63.afk.ui.util.humanBytes
import kotlin.math.roundToInt

/** RAM use from which the bar turns amber. */
private const val RAM_HIGH = 0.85f
private val BAR_SHAPE = RoundedCornerShape(3.dp)

/**
 * The laptop the app talks to: whether it is connected, its name from the latest `hello`, and its
 * RAM and CPU use from the latest [stats], when there are any.
 */
@Composable
fun LaptopStrip(
    hostname: String?,
    stats: Stats?,
    connection: ConnectionState,
    modifier: Modifier = Modifier
) {
    val colors = MaterialTheme.colorScheme
    val palette = LocalAfkPalette.current
    val shape = MaterialTheme.shapes.small
    val small = MaterialTheme.typography.labelSmall
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.surfaceContainerLow, shape)
            .border(1.dp, colors.outline, shape)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Dot(
            when (connection) {
                is ConnectionState.Connected -> palette.green
                is ConnectionState.Connecting -> palette.amber
                else -> colors.outline
            }
        )
        Text(
            text = hostname ?: connectionLabel(connection),
            modifier = Modifier.widthIn(max = 140.dp),
            style = small,
            fontWeight = FontWeight.SemiBold,
            color = colors.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        if (stats != null) {
            val ram = ramFraction(stats)
            Text("RAM", style = small, color = colors.onSurfaceVariant)
            Box(
                Modifier
                    .weight(1f)
                    .height(5.dp)
                    .clip(BAR_SHAPE)
                    .background(colors.surfaceContainerHighest)
            ) {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(ram)
                        .background(
                            if (ram >=
                                RAM_HIGH
                            ) {
                                palette.amber
                            } else {
                                colors.primary
                            },
                            BAR_SHAPE
                        )
                )
            }
            Text(
                text = "${humanBytes(stats.ramUsedBytes)} / ${humanBytes(stats.ramTotalBytes)}",
                style = small,
                color = colors.onSurfaceVariant
            )
            Text(
                "CPU ${stats.cpuPercent.roundToInt()}%",
                style = small,
                color = colors.onSurfaceVariant
            )
        }
    }
}

/** The share of RAM in use, 0 to 1; 0 when the total is unknown. */
private fun ramFraction(stats: Stats): Float = if (stats.ramTotalBytes > 0) {
    (stats.ramUsedBytes.toDouble() / stats.ramTotalBytes).toFloat().coerceIn(0f, 1f)
} else {
    0f
}

/** What stands for the laptop's name before the first `hello`. */
private fun connectionLabel(connection: ConnectionState): String = when (connection) {
    is ConnectionState.Connecting -> "Connecting…"
    else -> "Not connected"
}
