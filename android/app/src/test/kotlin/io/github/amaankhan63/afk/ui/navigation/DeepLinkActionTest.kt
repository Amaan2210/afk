package io.github.amaankhan63.afk.ui.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class DeepLinkActionTest {
    private val link = Routes.session("s_1")

    @Test fun theSessionInFrontIsLeftAsItIs() {
        assertEquals(DeepLinkAction.Ignore, deepLinkAction(Routes.SESSION, "s_1", link))
    }

    @Test fun aThreadOfTheSessionGoesBackToIt() {
        assertEquals(DeepLinkAction.PopTo, deepLinkAction(Routes.THREAD, "s_1", link))
    }

    @Test fun anotherScreenOpensTheSession() {
        assertEquals(DeepLinkAction.Navigate, deepLinkAction(Routes.SESSION, "s_2", link))
        assertEquals(DeepLinkAction.Navigate, deepLinkAction(Routes.THREAD, "s_2", link))
        assertEquals(DeepLinkAction.Navigate, deepLinkAction(Routes.SESSIONS, null, link))
        assertEquals(DeepLinkAction.Navigate, deepLinkAction(Routes.SETTINGS, null, link))
        assertEquals(DeepLinkAction.Navigate, deepLinkAction(null, null, link))
    }

    /** Unpaired, the link's session belongs to a pairing that is gone. */
    @Test fun thePairingScreenIgnoresIt() {
        assertEquals(DeepLinkAction.Ignore, deepLinkAction(Routes.PAIRING, null, link))
    }
}
