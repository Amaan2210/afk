package io.github.amaankhan63.afk.ui.session.chat.markdown

import androidx.compose.ui.text.AnnotatedString

/** One block of a chat message's markdown, as [Markdown.parse] reads it. */
sealed interface MdBlock {
    /** Lines of text, joined with their line breaks. */
    data class Paragraph(val text: AnnotatedString) : MdBlock

    /** A fenced block's lines as written; [lang] is the fence's language, if it names one. */
    data class Code(val code: String, val lang: String?) : MdBlock

    /** Consecutive `- ` or `* ` lines, one item each. */
    data class Bullets(val items: List<AnnotatedString>) : MdBlock
}
