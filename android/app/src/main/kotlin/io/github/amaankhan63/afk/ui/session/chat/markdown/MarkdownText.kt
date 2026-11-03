package io.github.amaankhan63.afk.ui.session.chat.markdown

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

private val CODE_SHAPE = RoundedCornerShape(8.dp)

/** [blocks] one under the other, in the chat's body text. */
@Composable
fun MarkdownText(blocks: List<MdBlock>, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Paragraph -> Text(
                    block.text,
                    style = MaterialTheme.typography.bodyMedium
                )

                is MdBlock.Code -> CodeBlock(block)

                is MdBlock.Bullets -> block.items.forEach { item ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("•", style = MaterialTheme.typography.bodyMedium)
                        Text(item, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

/** A code block: its language above its lines, which scroll sideways rather than wrap. */
@Composable
private fun CodeBlock(code: MdBlock.Code) {
    val colors = MaterialTheme.colorScheme
    Surface(Modifier.fillMaxWidth(), shape = CODE_SHAPE, color = colors.surfaceContainerHighest) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            code.lang?.let {
                Text(
                    it,
                    color = colors.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall
                )
            }
            Text(
                text = code.code,
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                softWrap = false
            )
        }
    }
}
