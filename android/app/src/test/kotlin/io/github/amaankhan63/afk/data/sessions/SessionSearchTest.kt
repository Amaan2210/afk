package io.github.amaankhan63.afk.data.sessions

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionSearchTest {
    @Test fun matchesBranchCaseInsensitively() =
        assertTrue(SessionSearch.matches(session(gitBranch = "feature/CI"), "ci"))

    @Test fun regexMetacharactersAreLiteral() {
        assertFalse(SessionSearch.matches(session(name = "abc"), "["))
        assertTrue(SessionSearch.matches(session(lastMessage = "ran f(x)"), "f(x)"))
        assertFalse(SessionSearch.matches(session(name = "abc"), "a*"))
        assertTrue(SessionSearch.matches(session(name = "glob *.kt"), "*.KT"))
        assertTrue(SessionSearch.matches(session(lastMessage = "see [docs]"), "[DOCS]"))
    }

    @Test fun blankMatchesAll() = assertTrue(SessionSearch.matches(session(), "   "))

    @Test fun searchesNameCwdBranchAndLastMessage() {
        val s = session(
            name = "api",
            cwd = "D:\\projects\\server",
            gitBranch = "main",
            lastMessage = "All tests pass"
        )
        for (query in listOf("API", "projects\\serv", "MAIN", "tests pass")) {
            assertTrue("query <$query>", SessionSearch.matches(s, query))
        }
        assertFalse(SessionSearch.matches(s, "codex"))
    }

    @Test fun absentFieldsMatchNothing() =
        assertFalse(SessionSearch.matches(session(gitBranch = null, lastMessage = null), "null"))
}
