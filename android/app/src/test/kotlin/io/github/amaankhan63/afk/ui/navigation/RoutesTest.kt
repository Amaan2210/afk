package io.github.amaankhan63.afk.ui.navigation

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric: [Uri] is a framework class. */
@RunWith(RobolectricTestRunner::class)
class RoutesTest {
    private fun parse(link: String): String? = Routes.parseDeepLink(Uri.parse(link))

    @Test fun sessionDeepLinkParses() {
        assertEquals("session/s_1", parse("afk://session/s_1"))
    }

    @Test fun everyIdCharacterParses() {
        val id = "Ab9._-" + "x".repeat(58)
        assertEquals("session/$id", parse("afk://session/$id"))
    }

    @Test fun unknownHostIsNull() {
        assertNull(parse("afk://other/x"))
    }

    @Test fun otherSchemeIsNull() {
        assertNull(parse("https://session/s_1"))
    }

    @Test fun extraSegmentIsNull() {
        assertNull(parse("afk://session/s_1/x"))
    }

    /** The id is untrusted: only a plain id may become a route. */
    @Test fun badIdIsNull() {
        listOf(
            "afk://session",
            "afk://session/",
            "afk://session/..",
            "afk://session/.",
            "afk://session/a%2Fb",
            "afk://session/a%20b",
            "afk://session/" + "a".repeat(65)
        ).forEach { assertNull(it, parse(it)) }
    }

    @Test fun routesFillTheirPatterns() {
        assertEquals("session/s_1", Routes.session("s_1"))
        assertEquals("session/s_1/thread/agent-a1", Routes.thread("s_1", "agent-a1"))
    }
}
