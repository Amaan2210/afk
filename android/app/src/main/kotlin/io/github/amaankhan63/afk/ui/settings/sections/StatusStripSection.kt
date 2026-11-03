package io.github.amaankhan63.afk.ui.settings.sections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.ui.session.StripChip

/** Which chips the status strip shows: every [StripChip], in the order the strip shows them. */
@Composable
internal fun StatusStripSection(chips: List<StripChip>, onChip: (StripChip, Boolean) -> Unit) {
    SettingsGroup("Status strip · pick what shows") {
        FlowRow(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            StripChip.entries.forEach { chip ->
                val selected = chip in chips
                CheckChip(label(chip), selected, onClick = { onChip(chip, !selected) })
            }
        }
    }
}

private fun label(chip: StripChip): String = when (chip) {
    StripChip.Model -> "Model"
    StripChip.Thinking -> "Thinking"
    StripChip.CtxUsed -> "Ctx used"
    StripChip.CtxSize -> "Ctx size"
    StripChip.Cost -> "Cost"
    StripChip.FiveHour -> "5h limit"
    StripChip.SevenDay -> "7d limit"
    StripChip.SessionTime -> "Session time"
    StripChip.Memory -> "Memory"
    StripChip.TokensInOut -> "Tokens in/out"
}
