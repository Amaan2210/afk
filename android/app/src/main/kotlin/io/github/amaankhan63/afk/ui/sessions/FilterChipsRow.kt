package io.github.amaankhan63.afk.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.sessions.SessionFilter
import io.github.amaankhan63.afk.data.sessions.StateFilter
import io.github.amaankhan63.afk.ui.components.agentLabel

private val AGENTS = listOf(SessionKind.claude, SessionKind.codex, SessionKind.shell)
private val ROW_PADDING = PaddingValues(horizontal = 14.dp)
private val CHIP_GAP = 6.dp

/**
 * The state chips, one of which is always selected, above the agent chips, any of which can be;
 * no agent selected means every agent. State chips but `All` show [counts].
 */
@Composable
fun FilterChipsRow(
    filter: SessionFilter,
    counts: Map<StateFilter, Int>,
    onFilter: (SessionFilter) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier) {
        LazyRow(
            contentPadding = ROW_PADDING,
            horizontalArrangement = Arrangement.spacedBy(CHIP_GAP)
        ) {
            items(StateFilter.entries) { state ->
                FilterChip(
                    selected = filter.state == state,
                    onClick = { onFilter(filter.copy(state = state)) },
                    label = { Text(stateChipLabel(state, counts[state])) }
                )
            }
        }
        HorizontalDivider(Modifier.padding(horizontal = 14.dp, vertical = 2.dp))
        LazyRow(
            contentPadding = ROW_PADDING,
            horizontalArrangement = Arrangement.spacedBy(CHIP_GAP)
        ) {
            items(AGENTS) { kind ->
                val selected = kind in filter.agents
                FilterChip(
                    selected = selected,
                    onClick = {
                        val agents = if (selected) filter.agents - kind else filter.agents + kind
                        onFilter(filter.copy(agents = agents))
                    },
                    label = { Text(agentLabel(kind)) }
                )
            }
        }
    }
}

private fun stateChipLabel(state: StateFilter, count: Int?): String {
    val name = when (state) {
        StateFilter.All -> return "All"
        StateFilter.NeedsYou -> "Needs you"
        StateFilter.Working -> "Working"
        StateFilter.Done -> "Done"
    }
    return if (count == null) name else "$name · $count"
}
