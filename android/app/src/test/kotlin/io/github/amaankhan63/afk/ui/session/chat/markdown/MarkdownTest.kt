package io.github.amaankhan63.afk.ui.session.chat.markdown

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownTest {
    /** The blocks of [text] as plain strings: `P:` paragraph, `C(lang):` code, `B:` bullets. */
    private fun shape(text: String): List<String> = Markdown.parse(text).map {
        when (it) {
            is MdBlock.Paragraph -> "P:${it.text.text}"
            is MdBlock.Code -> "C(${it.lang}):${it.code}"
            is MdBlock.Bullets -> "B:" + it.items.joinToString("|") { item -> item.text }
        }
    }

    /** The one block of [text], a paragraph. */
    private fun paragraph(text: String): AnnotatedString {
        val blocks = Markdown.parse(text)
        assertEquals(1, blocks.size)
        return (blocks[0] as MdBlock.Paragraph).text
    }

    /** Each span as the text it covers and its style. */
    private fun spans(text: AnnotatedString): List<Pair<String, SpanStyle>> =
        text.spanStyles.map { text.text.substring(it.start, it.end) to it.item }

    @Test fun boldItalicCodeSpans() {
        val p = Markdown.parse("a **b** _c_ `d`")[0] as MdBlock.Paragraph
        assertEquals("a b c d", p.text.text)
        assertEquals(3, p.text.spanStyles.size)
    }

    @Test fun spansCarryTheirStyles() {
        assertEquals(
            listOf(
                "b" to SpanStyle(fontWeight = FontWeight.Bold),
                "i" to SpanStyle(fontStyle = FontStyle.Italic),
                "u" to SpanStyle(fontStyle = FontStyle.Italic),
                "c" to SpanStyle(fontFamily = FontFamily.Monospace)
            ),
            spans(paragraph("**b** *i* _u_ `c`"))
        )
    }

    @Test fun fencedCodeBecomesBlock() {
        val b = Markdown.parse("x\n```ts\nlet a=1\n```\ny")
        assertTrue(b[1] is MdBlock.Code)
        assertEquals("ts", (b[1] as MdBlock.Code).lang)
        assertEquals(listOf("P:x", "C(ts):let a=1", "P:y"), shape("x\n```ts\nlet a=1\n```\ny"))
    }

    @Test fun fenceKeepsItsLinesVerbatim() {
        assertEquals(
            listOf("C(null):**not bold**\n\n  - not a bullet"),
            shape("```\n**not bold**\n\n  - not a bullet\n```")
        )
    }

    @Test fun fenceWithoutLanguageHasNone() {
        assertNull((Markdown.parse("```\nx\n```")[0] as MdBlock.Code).lang)
    }

    @Test fun windowsLineEndingsAreLineBreaks() {
        assertEquals(
            listOf("C(ts):let a=1", "P:a\nb"),
            shape("```ts\r\nlet a=1\r\n```\r\na\r\nb")
        )
    }

    @Test fun longerFenceHoldsAShorterOne() {
        assertEquals(
            listOf("C(md):```kotlin\nval x = 1\n```"),
            shape("````md\n```kotlin\nval x = 1\n```\n````")
        )
    }

    /** As in CommonMark: an unclosed fence runs to the end of the text. */
    @Test fun unterminatedFenceRunsToTheEnd() {
        assertEquals(listOf("P:x", "C(sh):a\nb"), shape("x\n```sh\na\nb"))
    }

    /** As in CommonMark: a backtick in the info string makes it inline code, not a fence. */
    @Test fun fenceOpenerWithBackticksInItsInfoIsText() {
        assertEquals("``a`` and more", paragraph("```a``` and more").text)
    }

    @Test fun bulletsGrouped() =
        assertEquals(2, (Markdown.parse("- one\n- two")[0] as MdBlock.Bullets).items.size)

    @Test fun asteriskBulletsAndInlineSpansInItems() {
        val bullets = Markdown.parse("* **one**\n* two")[0] as MdBlock.Bullets
        assertEquals(listOf("one", "two"), bullets.items.map { it.text })
        assertEquals(1, bullets.items[0].spanStyles.size)
    }

    @Test fun bulletsAndParagraphsSplitEachOther() {
        assertEquals(listOf("P:intro", "B:a|b", "P:after"), shape("intro\n- a\n- b\nafter"))
    }

    @Test fun italicAtLineStartIsNotABullet() {
        val text = paragraph("*x* text")
        assertEquals("x text", text.text)
        assertEquals(1, text.spanStyles.size)
    }

    @Test fun linkRendersLabelOnly() = assertEquals(
        "see docs",
        (Markdown.parse("see [docs](https://x)")[0] as MdBlock.Paragraph).text.text
    )

    @Test fun linesJoinAndBlankLinesSeparate() {
        assertEquals(listOf("P:one\ntwo", "P:three"), shape("one\ntwo\n\n\nthree"))
    }

    @Test fun unsupportedSyntaxStaysAsWritten() {
        val text = "# Title\n1. first\n| a | b |\n  - nested\n> quote"
        assertEquals(listOf("P:$text"), shape(text))
    }

    @Test fun unterminatedMarkersAreLiteral() {
        val text = paragraph("a **b _c `d [e](f")
        assertEquals("a **b _c `d [e](f", text.text)
        assertEquals(0, text.spanStyles.size)
    }

    @Test fun snakeCaseAndSpacedAsterisksAreLiteral() {
        val text = paragraph("allow_always and pending_changed, 2 * 3 * 4, ** x **")
        assertEquals("allow_always and pending_changed, 2 * 3 * 4, ** x **", text.text)
        assertEquals(0, text.spanStyles.size)
    }

    @Test fun markersInsideCodeAreLiteral() {
        val text = paragraph("`**x** _y_ [z](u)`")
        assertEquals(
            listOf("**x** _y_ [z](u)" to SpanStyle(fontFamily = FontFamily.Monospace)),
            spans(text)
        )
    }

    @Test fun blankTextHasNoBlocks() {
        assertEquals(emptyList<MdBlock>(), Markdown.parse(""))
        assertEquals(emptyList<MdBlock>(), Markdown.parse(" \n\r\n\t"))
    }

    @Test fun neverThrows() {
        val inputs = listOf(
            "[", "]", "(", "`", "``", "```", "````", "*", "**", "***", "_", "__", "- ", "-", "* ",
            "[a](", "[a]", "[](x)", "**a", "a**", "_a", "`a", "```\n", "```\n```\n```",
            "****", "*_*_`*`_*", "\r", "\r\n", "\n\n\n", "- \n- ", "* * *", "_ _", "`\n`",
            "**".repeat(5_000), "_a".repeat(5_000), "[".repeat(5_000) + "]".repeat(5_000)
        )
        inputs.forEach { Markdown.parse(it) }
    }
}
