package io.github.amaankhan63.afk.ui.session.chat.markdown

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/**
 * The markdown subset chat messages use. Blocks, line by line: fenced code (three or more
 * backticks and an optional language; an unclosed fence runs to the end, as in CommonMark), runs of
 * `- ` or `* ` bullets, and paragraphs of the other lines, split by blank lines and keeping their
 * line breaks. Spans, within a line and not nested: `**bold**`, `*italic*`, `_italic_` (not inside
 * a word), `` `code` `` (its markers stay literal) and `[label](url)`, which shows the label.
 * Anything else, such as a heading, a numbered or nested list or an unclosed marker, stays as
 * written.
 */
object Markdown {
    private val FENCE = Regex("""^\s*(`{3,})([^`]*)$""")
    private val BULLET = Regex("""^[-*] (.*)$""")

    // One alternative per span, tried in this order at each place: code first, so markers in it
    // stay literal. Each content runs possessively up to its closing marker, never backtracking.
    private val SPAN = Regex(
        """`([^`\n]++)`""" +
            """|\[([^\]\n]++)\]\([^)\s]*+\)""" +
            """|\*\*(?!\s)([^*\n]++)(?<!\s)\*\*""" +
            """|\*(?!\s)([^*\n]++)(?<!\s)\*""" +
            """|(?<!\w)_(?!\s)([^_\n]++)(?<!\s)_(?!\w)"""
    )

    private val CODE = SpanStyle(fontFamily = FontFamily.Monospace)
    private val BOLD = SpanStyle(fontWeight = FontWeight.Bold)
    private val ITALIC = SpanStyle(fontStyle = FontStyle.Italic)

    fun parse(text: String): List<MdBlock> {
        val blocks = mutableListOf<MdBlock>()
        val paragraph = mutableListOf<String>()
        val bullets = mutableListOf<String>()

        fun flush() {
            if (paragraph.isNotEmpty()) {
                blocks += MdBlock.Paragraph(spans(paragraph.joinToString("\n")))
            }
            if (bullets.isNotEmpty()) blocks += MdBlock.Bullets(bullets.map { spans(it) })
            paragraph.clear()
            bullets.clear()
        }

        val lines = text.lines()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val fence = FENCE.find(line)
            val bullet = BULLET.find(line)
            when {
                fence != null -> {
                    flush()
                    val close = fence.groupValues[1].length
                    val end = (i + 1 until lines.size)
                        .firstOrNull { closes(lines[it], close) } ?: lines.size
                    val lang = fence.groupValues[2].trim().substringBefore(' ').ifEmpty { null }
                    blocks += MdBlock.Code(lines.subList(i + 1, end).joinToString("\n"), lang)
                    i = end
                }

                line.isBlank() -> flush()

                bullet != null -> {
                    if (paragraph.isNotEmpty()) flush()
                    bullets += bullet.groupValues[1]
                }

                else -> {
                    if (bullets.isNotEmpty()) flush()
                    paragraph += line
                }
            }
            i++
        }
        flush()
        return blocks
    }

    /** Whether [line] closes a fence opened with [length] backticks. */
    private fun closes(line: String, length: Int): Boolean {
        val fence = line.trim()
        return fence.length >= length && fence.all { it == '`' }
    }

    private fun spans(text: String): AnnotatedString = buildAnnotatedString {
        var at = 0
        for (match in SPAN.findAll(text)) {
            append(text, at, match.range.first)
            val (code, label, bold, star, underscore) = match.destructured
            when {
                code.isNotEmpty() -> withStyle(CODE) { append(code) }
                label.isNotEmpty() -> append(label)
                bold.isNotEmpty() -> withStyle(BOLD) { append(bold) }
                else -> withStyle(ITALIC) { append(star.ifEmpty { underscore }) }
            }
            at = match.range.last + 1
        }
        append(text, at, text.length)
    }
}
