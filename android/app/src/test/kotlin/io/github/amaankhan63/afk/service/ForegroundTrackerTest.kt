package io.github.amaankhan63.afk.service

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ForegroundTrackerTest {
    private val session = Any()
    private val thread = Any()

    @After fun tearDown() {
        ForegroundTracker.release(session)
        ForegroundTracker.release(thread)
    }

    /**
     * A back gesture from a sub-agent's thread, given up: the thread resumes before the session's
     * screen under it pauses. The session stays in front until the thread leaves too.
     */
    @Test fun twoScreensOfOneSessionReleasedOutOfOrder() {
        ForegroundTracker.claim(session, "s_1")
        ForegroundTracker.claim(thread, "s_1")

        ForegroundTracker.release(session)
        assertEquals("s_1", ForegroundTracker.foregroundSessionId.value)

        ForegroundTracker.release(thread)
        assertNull(ForegroundTracker.foregroundSessionId.value)
    }

    @Test fun theLatestClaimWinsAndAnEarlierOneComesBack() {
        ForegroundTracker.claim(session, "s_1")
        ForegroundTracker.claim(thread, "s_2")
        assertEquals("s_2", ForegroundTracker.foregroundSessionId.value)

        ForegroundTracker.release(thread)
        assertEquals("s_1", ForegroundTracker.foregroundSessionId.value)
    }

    @Test fun claimingAgainMakesTheClaimTheLatest() {
        ForegroundTracker.claim(session, "s_1")
        ForegroundTracker.claim(thread, "s_2")

        ForegroundTracker.claim(session, "s_1")
        assertEquals("s_1", ForegroundTracker.foregroundSessionId.value)

        ForegroundTracker.release(session)
        assertEquals("s_2", ForegroundTracker.foregroundSessionId.value)
    }

    @Test fun releasingWithoutAClaimChangesNothing() {
        ForegroundTracker.claim(session, "s_1")

        ForegroundTracker.release(thread)

        assertEquals("s_1", ForegroundTracker.foregroundSessionId.value)
    }
}
