package io.github.amaankhan63.afk.ui.navigation

/** What the navigation does with a link to a session's route. */
internal enum class DeepLinkAction {
    /** Nothing: the session is already in front, or the app is not paired. */
    Ignore,

    /** Back to the session, which is under the screen in front: one of its sub-agent threads. */
    PopTo,

    /** Open the session over the session list. */
    Navigate
}

/**
 * What a link to session [route] does while the screen in front has the route pattern [topRoute]
 * and the `id` argument [topId]. The session already in front stays as it is (its draft, tab and
 * terminal included): it is not opened again.
 */
internal fun deepLinkAction(topRoute: String?, topId: String?, route: String): DeepLinkAction {
    val sameSession = topId != null && Routes.session(topId) == route
    return when {
        topRoute == Routes.PAIRING -> DeepLinkAction.Ignore
        topRoute == Routes.SESSION && sameSession -> DeepLinkAction.Ignore
        topRoute == Routes.THREAD && sameSession -> DeepLinkAction.PopTo
        else -> DeepLinkAction.Navigate
    }
}
