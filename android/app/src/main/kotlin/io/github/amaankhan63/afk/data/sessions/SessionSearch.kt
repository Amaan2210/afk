package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.Session

/** The sessions screen's search box. */
object SessionSearch {
    /**
     * True when [query] occurs, literally and ignoring case, in the session's name, folder, git
     * branch or last message. Characters such as `[`, `(` and `*` match themselves. A blank
     * query matches every session.
     */
    fun matches(s: Session, query: String): Boolean {
        if (query.isBlank()) return true
        return listOfNotNull(s.name, s.cwd, s.gitBranch, s.lastMessage)
            .any { it.contains(query, ignoreCase = true) }
    }
}
