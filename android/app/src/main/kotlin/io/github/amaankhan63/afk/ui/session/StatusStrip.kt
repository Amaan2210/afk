package io.github.amaankhan63.afk.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

private val CHIP_SHAPE = RoundedCornerShape(7.dp)
private const val MODEL_FILL_ALPHA = 0.12f
private const val MODEL_BORDER_ALPHA = 0.35f

/**
 * The session's status, one row of [chips] under the tabs that scrolls sideways; nothing,
 * taking no space, when [chips] is empty. The model's chip is in the accent colour.
 */
@Composable
fun StatusStrip(chips: List<String>, modifier: Modifier = Modifier) {
    if (chips.isEmpty()) return
    Column(modifier.fillMaxWidth()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        LazyRow(
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            items(chips) { Chip(it, model = it.startsWith(MODEL_MARK)) }
        }
    }
}

@Composable
private fun Chip(text: String, model: Boolean) {
    val colors = MaterialTheme.colorScheme
    val accent = colors.primary
    val fill = if (model) accent.copy(alpha = MODEL_FILL_ALPHA) else colors.surfaceContainerHighest
    val border = if (model) accent.copy(alpha = MODEL_BORDER_ALPHA) else colors.outline
    Text(
        text = text,
        modifier = Modifier
            .background(fill, CHIP_SHAPE)
            .border(1.dp, border, CHIP_SHAPE)
            .padding(horizontal = 8.dp, vertical = 3.dp),
        color = if (model) accent else colors.onSurfaceVariant,
        style = MaterialTheme.typography.labelSmall,
        fontFamily = FontFamily.Monospace,
        maxLines = 1
    )
}
