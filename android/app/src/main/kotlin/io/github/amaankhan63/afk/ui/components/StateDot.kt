package io.github.amaankhan63.afk.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.ui.theme.AfkPalette
import io.github.amaankhan63.afk.ui.theme.LocalAfkPalette

private val DOT = 7.dp
private val HALO = 3.dp
private const val HALO_ALPHA = 0.22f

/** The colour of a session in [state]. */
fun AfkPalette.stateColor(state: SessionState): Color = when (state) {
    SessionState.needs_input -> amber
    SessionState.working -> blue
    SessionState.finished -> green
    SessionState.idle -> text2
    SessionState.ended -> border
}

/** A session's state as a coloured dot; the states that want attention glow. */
@Composable
fun StateDot(state: SessionState, modifier: Modifier = Modifier) {
    val glows = state == SessionState.needs_input || state == SessionState.working
    Dot(LocalAfkPalette.current.stateColor(state), modifier, halo = glows)
}

/** A [DOT]-wide dot of [color], ringed by a faint halo when [halo]; laid out with room for it. */
@Composable
fun Dot(color: Color, modifier: Modifier = Modifier, halo: Boolean = false) {
    Canvas(modifier.size(DOT + HALO * 2)) {
        if (halo) drawCircle(color.copy(alpha = HALO_ALPHA))
        drawCircle(color, radius = DOT.toPx() / 2)
    }
}
